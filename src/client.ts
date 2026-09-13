import {
  TumblrApiError,
  TumblrAuthError,
  TumblrNotFoundError,
  TumblrRateLimitError,
} from './errors.js'
import type { RawPost, RetryPolicy, RetryReason } from './types.js'

export const DEFAULT_BASE_URL = 'https://api.tumblr.com/v2'

/** Tumblr requires a stable User-Agent; Node sends "node" by default. */
export const DEFAULT_USER_AGENT = 'tumblr-tags (+https://github.com/romanyanke/tumblr-tags)'

export const DEFAULT_RETRY: Required<RetryPolicy> = {
  attempts: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  timeoutMs: 15_000,
  jitter: 0.3,
  maxRateLimitWaitMs: 0,
}

/** Tumblr always wraps its answer in an envelope, even when the HTTP status says error. */
interface Envelope {
  meta?: { status?: number; msg?: string }
  response?: { posts?: unknown[]; total_posts?: number; blog?: { total_posts?: number } }
}

export interface PostsPage {
  posts: RawPost[]
  totalPosts: number
}

export interface ClientOptions {
  consumerKey: string
  baseUrl?: string
  userAgent?: string
  retry?: RetryPolicy
  fetch?: typeof globalThis.fetch
  signal?: AbortSignal
  /** Called before every pause between attempts. */
  onRetry?: (info: { attempt: number; delayMs: number; reason: RetryReason }) => void
  /** Called before every HTTP request; throwing here stops the crawl. */
  onRequest?: () => void
}

/** Internal error marking a request worth retrying. */
class RetryableError extends Error {
  readonly reason: RetryReason
  readonly retryAfterMs: number | undefined

  constructor(message: string, reason: RetryReason, retryAfterMs?: number) {
    super(message)
    this.name = 'RetryableError'
    this.reason = reason
    this.retryAfterMs = retryAfterMs
  }
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)

      return
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    // Without this an abort waits out the pause — up to thirty seconds per attempt.
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })

/** `Retry-After` comes either as a number of seconds or as an HTTP date. */
const parseRetryAfter = (value: string | null): number | undefined => {
  if (!value) {
    return undefined
  }

  const seconds = Number(value)

  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000)
  }

  const date = Date.parse(value)

  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

const rateLimitReset = (headers: Headers): { ms?: number; scope?: 'hour' | 'day' } => {
  const retryAfter = parseRetryAfter(headers.get('retry-after'))

  if (retryAfter !== undefined) {
    return { ms: retryAfter, scope: 'hour' }
  }

  for (const [header, scope] of [
    ['x-ratelimit-perhour-reset', 'hour'],
    ['x-ratelimit-perday-reset', 'day'],
  ] as const) {
    const seconds = Number(headers.get(header))

    if (Number.isFinite(seconds) && seconds > 0) {
      return { ms: seconds * 1000, scope }
    }
  }

  return {}
}

const toRawPost = (input: unknown): RawPost | null => {
  if (typeof input !== 'object' || input === null) {
    return null
  }

  const post = input as Record<string, unknown>
  // id_string, not id: Tumblr's numeric ids are longer than a double holds exactly.
  const id = typeof post.id_string === 'string' ? post.id_string : String(post.id ?? '')

  if (!id) {
    return null
  }

  return {
    id,
    timestamp: typeof post.timestamp === 'number' ? post.timestamp : 0,
    tags: Array.isArray(post.tags)
      ? post.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
  }
}

export class TumblrClient {
  readonly #consumerKey: string
  readonly #baseUrl: string
  readonly #userAgent: string
  readonly #retry: Required<RetryPolicy>
  readonly #fetch: typeof globalThis.fetch
  readonly #signal: AbortSignal | undefined
  readonly #onRetry: ClientOptions['onRetry']
  readonly #onRequest: ClientOptions['onRequest']

  /** How many HTTP requests were made, retries included. */
  requests = 0

  constructor(options: ClientOptions) {
    this.#consumerKey = options.consumerKey
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    this.#userAgent = options.userAgent ?? DEFAULT_USER_AGENT
    this.#retry = { ...DEFAULT_RETRY, ...options.retry }
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#signal = options.signal
    this.#onRetry = options.onRetry
    this.#onRequest = options.onRequest
  }

  /**
   * A page of the blog's posts. `total_posts` arrives in the same response, so
   * a separate call to `/info` is unnecessary.
   */
  async posts(
    blog: string,
    params: { limit?: number; offset?: number; id?: string },
  ): Promise<PostsPage> {
    const query = new URLSearchParams({
      api_key: this.#consumerKey,
      reblog_info: 'false',
      notes_info: 'false',
    })

    if (params.id !== undefined) {
      query.set('id', params.id)
    } else {
      query.set('limit', String(params.limit ?? 20))
      query.set('offset', String(params.offset ?? 0))
    }

    const url = `${this.#baseUrl}/blog/${encodeURIComponent(blog)}/posts?${query.toString()}`
    const body = await this.#request(url)
    const response = body.response ?? {}
    const posts = (response.posts ?? [])
      .map(toRawPost)
      .filter((post): post is RawPost => post !== null)

    return {
      posts,
      totalPosts: response.total_posts ?? response.blog?.total_posts ?? 0,
    }
  }

  async #request(url: string): Promise<Envelope> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.#attempt(url)
      } catch (error) {
        if (!(error instanceof RetryableError) || attempt >= this.#retry.attempts) {
          throw error instanceof RetryableError ? this.#exhausted(error, url) : error
        }

        const delayMs = error.retryAfterMs ?? this.#backoff(attempt)

        this.#onRetry?.({ attempt, delayMs, reason: error.reason })
        await sleep(delayMs, this.#signal)
      }
    }
  }

  async #attempt(url: string): Promise<Envelope> {
    this.#onRequest?.()
    this.requests++

    const signals = [AbortSignal.timeout(this.#retry.timeoutMs)]

    if (this.#signal) {
      signals.push(this.#signal)
    }

    let response: Response

    try {
      response = await this.#fetch(url, {
        headers: { 'user-agent': this.#userAgent, accept: 'application/json' },
        signal: AbortSignal.any(signals),
      })
    } catch (error) {
      if (this.#signal?.aborted) {
        throw error
      }

      const timedOut = (error as Error)?.name === 'TimeoutError'

      throw new RetryableError(
        `Request failed: ${(error as Error)?.message ?? 'unknown error'}`,
        timedOut ? 'timeout' : 'network',
      )
    }

    return this.#envelope(response, url)
  }

  async #envelope(response: Response, url: string): Promise<Envelope> {
    if (response.status === 429) {
      // The daily quota will not come back before midnight — nothing to retry.
      if (response.headers.get('x-ratelimit-perday-remaining') === '0') {
        throw new TumblrRateLimitError('Tumblr daily request quota exhausted.', {
          status: 429,
          url: redact(url),
          scope: 'day',
        })
      }

      const { ms, scope } = rateLimitReset(response.headers)

      if (ms !== undefined && ms > this.#retry.maxRateLimitWaitMs) {
        throw new TumblrRateLimitError(
          `Tumblr rate limit reached, resets in ${Math.ceil(ms / 1000)}s.`,
          {
            status: 429,
            url: redact(url),
            resetInSeconds: Math.ceil(ms / 1000),
            ...(scope ? { scope } : {}),
          },
        )
      }

      throw new RetryableError('Tumblr rate limit.', 'rate-limit', ms)
    }

    if (response.status === 401 || response.status === 403) {
      throw new TumblrAuthError('Tumblr rejected the consumer key.', {
        status: response.status,
        url: redact(url),
      })
    }

    if (response.status === 404) {
      throw new TumblrNotFoundError('Blog or post not found.', { status: 404, url: redact(url) })
    }

    if (response.status >= 500) {
      throw new RetryableError(`Tumblr answered ${response.status}.`, 'server')
    }

    if (response.status >= 400) {
      throw new TumblrApiError(`Tumblr answered ${response.status}.`, {
        status: response.status,
        url: redact(url),
      })
    }

    // This is where 1.x crashed: on an empty body it carried on and dereferenced null.
    const body = (await response.json().catch(() => null)) as Envelope | null

    if (!body || typeof body !== 'object') {
      throw new RetryableError('Tumblr returned an empty body.', 'empty-body')
    }

    const metaStatus = body.meta?.status

    if (typeof metaStatus === 'number' && metaStatus >= 400) {
      const meta = { status: metaStatus, msg: body.meta?.msg ?? '' }

      if (metaStatus === 401 || metaStatus === 403) {
        throw new TumblrAuthError('Tumblr rejected the consumer key.', {
          status: metaStatus,
          url: redact(url),
          meta,
        })
      }

      if (metaStatus === 404) {
        throw new TumblrNotFoundError('Blog or post not found.', {
          status: 404,
          url: redact(url),
          meta,
        })
      }

      throw new RetryableError(`Tumblr answered ${metaStatus} inside the envelope.`, 'server')
    }

    if (!body.response) {
      throw new RetryableError('Tumblr response has no response field.', 'empty-body')
    }

    return body
  }

  #backoff(attempt: number): number {
    const step = Math.min(this.#retry.maxDelayMs, this.#retry.baseDelayMs * 2 ** (attempt - 1))

    return Math.round(step * (1 + Math.random() * this.#retry.jitter))
  }

  #exhausted(error: RetryableError, url: string): TumblrApiError {
    return new TumblrApiError(`${error.message} Attempts exhausted (${this.#retry.attempts}).`, {
      status: 0,
      url: redact(url),
    })
  }
}

/** The key must never reach error messages or logs. */
export const redact = (url: string): string => url.replace(/(api_key=)[^&]*/, '$1***')
