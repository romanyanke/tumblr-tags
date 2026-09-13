import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { redact, TumblrClient } from '../../src/client.js'
import {
  TumblrApiError,
  TumblrAuthError,
  TumblrNotFoundError,
  TumblrRateLimitError,
} from '../../src/errors.js'
import { mockFetch, postsResponse } from '../helpers/mock-fetch.js'

const KEY = 'super-secret-key'

const client = (fetch: typeof globalThis.fetch, retry = {}) =>
  new TumblrClient({ consumerKey: KEY, fetch, retry: { baseDelayMs: 10, jitter: 0, ...retry } })

describe('response parsing', () => {
  it('takes posts and the total from one response — /info is unnecessary', async () => {
    const { fetch, urls } = mockFetch([{ body: postsResponse([{ id: '1', tags: ['cat'] }], 4213) }])

    const page = await client(fetch).posts('my-blog', { limit: 20, offset: 0 })

    expect(page.totalPosts).toBe(4213)
    expect(page.posts).toEqual([{ id: '1', timestamp: 1_600_000_000, tags: ['cat'] }])
    expect(urls[0]).toContain('/blog/my-blog/posts')
    expect(urls[0]).toContain('limit=20')
  })

  it('uses id_string rather than the numeric id', async () => {
    const id = '781234567890123456'
    const { fetch } = mockFetch([{ body: postsResponse([{ id }]) }])
    const page = await client(fetch).posts('blog', {})

    expect(page.posts[0]?.id).toBe(id)
    expect(Number(id).toString()).not.toBe(id)
  })

  it('encodes the blog name in the URL', async () => {
    const { fetch, urls } = mockFetch([{ body: postsResponse([]) }])

    await client(fetch).posts('my-blog.tumblr.com', {})

    expect(urls[0]).toContain('/blog/my-blog.tumblr.com/posts')
  })

  it('requests a single post by id', async () => {
    const { fetch, urls } = mockFetch([{ body: postsResponse([{ id: '7' }]) }])

    await client(fetch).posts('blog', { id: '7' })

    expect(urls[0]).toContain('id=7')
    expect(urls[0]).not.toContain('offset=')
  })

  it('sends a stable User-Agent — Tumblr requires one', async () => {
    let sent: Record<string, string> = {}

    const fn = vi.fn(async (_input: unknown, init?: RequestInit) => {
      sent = (init?.headers ?? {}) as Record<string, string>

      return new Response(JSON.stringify(postsResponse([])))
    })

    await new TumblrClient({
      consumerKey: KEY,
      fetch: fn as unknown as typeof globalThis.fetch,
    }).posts('b', {})

    expect(sent['user-agent']).toContain('tumblr-tags')
  })
})

describe('retries', () => {
  it('retries an empty body — the thing 1.x crashed on', async () => {
    const { fetch, calls } = mockFetch([{ raw: '' }, { body: postsResponse([{ id: '1' }]) }])
    const page = await client(fetch).posts('blog', {})

    expect(calls()).toBe(2)
    expect(page.posts).toHaveLength(1)
  })

  it('retries a response without a response field', async () => {
    const { fetch, calls } = mockFetch([
      { body: { meta: { status: 200 } } },
      { body: postsResponse([{ id: '1' }]) },
    ])

    await client(fetch).posts('blog', {})

    expect(calls()).toBe(2)
  })

  it('retries 5xx and gives up after the configured number of attempts', async () => {
    const { fetch, calls } = mockFetch([{ status: 503 }])

    await expect(client(fetch, { attempts: 3 }).posts('blog', {})).rejects.toThrow(TumblrApiError)
    expect(calls()).toBe(3)
  })

  it('retries a dropped connection', async () => {
    const { fetch, calls } = mockFetch([
      { throws: new TypeError('fetch failed') },
      { body: postsResponse([{ id: '1' }]) },
    ])

    await client(fetch).posts('blog', {})

    expect(calls()).toBe(2)
  })

  it('retries an error named only inside the envelope', async () => {
    const { fetch, calls } = mockFetch([
      { status: 200, body: { meta: { status: 500, msg: 'Server Error' } } },
      { body: postsResponse([{ id: '1' }]) },
    ])

    await client(fetch).posts('blog', {})

    expect(calls()).toBe(2)
  })

  it('grows the pause between attempts', async () => {
    vi.useFakeTimers()

    try {
      const { fetch, calls } = mockFetch([{ status: 500 }])
      const delays: number[] = []
      const instance = new TumblrClient({
        consumerKey: KEY,
        fetch,
        retry: { attempts: 4, baseDelayMs: 1000, jitter: 0 },
        onRetry: info => delays.push(info.delayMs),
      })

      const promise = instance.posts('blog', {}).catch(() => undefined)

      await vi.runAllTimersAsync()
      await promise

      expect(delays).toEqual([1000, 2000, 4000])
      expect(calls()).toBe(4)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('what is never retried', () => {
  it('401 and 403 mean authorization refused', async () => {
    for (const status of [401, 403]) {
      const { fetch, calls } = mockFetch([{ status }])

      await expect(client(fetch).posts('blog', {})).rejects.toThrow(TumblrAuthError)
      expect(calls()).toBe(1)
    }
  })

  it('404 means the blog is gone', async () => {
    const { fetch, calls } = mockFetch([{ status: 404 }])

    await expect(client(fetch).posts('blog', {})).rejects.toThrow(TumblrNotFoundError)
    expect(calls()).toBe(1)
  })

  it('401 inside the envelope of an HTTP 200', async () => {
    const { fetch } = mockFetch([
      { status: 200, body: { meta: { status: 401, msg: 'Not Authorized' } } },
    ])

    await expect(client(fetch).posts('blog', {})).rejects.toThrow(TumblrAuthError)
  })
})

describe('rate limiting', () => {
  it('does not wait an hour, it reports the reset time', async () => {
    const { fetch, calls } = mockFetch([
      { status: 429, headers: { 'x-ratelimit-perhour-reset': '3400' } },
    ])

    const error = await client(fetch)
      .posts('blog', {})
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(TumblrRateLimitError)
    expect((error as TumblrRateLimitError).resetInSeconds).toBe(3400)
    expect((error as TumblrRateLimitError).scope).toBe('hour')
    expect(calls()).toBe(1)
  })

  it('never retries an exhausted daily quota', async () => {
    const { fetch, calls } = mockFetch([
      { status: 429, headers: { 'x-ratelimit-perday-remaining': '0' } },
    ])

    const error = await client(fetch)
      .posts('blog', {})
      .catch((e: unknown) => e)

    expect((error as TumblrRateLimitError).scope).toBe('day')
    expect(calls()).toBe(1)
  })

  it('waits out a short Retry-After when allowed to', async () => {
    const { fetch, calls } = mockFetch([
      { status: 429, headers: { 'retry-after': '1' } },
      { body: postsResponse([{ id: '1' }]) },
    ])

    const instance = new TumblrClient({
      consumerKey: KEY,
      fetch,
      retry: { baseDelayMs: 5, jitter: 0, maxRateLimitWaitMs: 5_000 },
    })

    await instance.posts('blog', {})

    expect(calls()).toBe(2)
  })
})

describe('cancellation and timeouts', () => {
  it('cancels the pause between attempts instead of sitting it out', async () => {
    const controller = new AbortController()
    const { fetch } = mockFetch([{ status: 500 }])
    const instance = new TumblrClient({
      consumerKey: KEY,
      fetch,
      signal: controller.signal,
      retry: { attempts: 5, baseDelayMs: 60_000, jitter: 0 },
      onRetry: () => controller.abort(new Error('stopped')),
    })

    const started = Date.now()

    await expect(instance.posts('blog', {})).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('treats a timeout as a reason to retry', async () => {
    const { fetch, calls } = mockFetch([
      { throws: Object.assign(new Error('timed out'), { name: 'TimeoutError' }) },
      { body: postsResponse([{ id: '1' }]) },
    ])

    await client(fetch).posts('blog', {})

    expect(calls()).toBe(2)
  })
})

describe('the access key', () => {
  it('reaches neither the message nor the url field of an error', async () => {
    const { fetch } = mockFetch([{ status: 500 }])
    const error = (await client(fetch, { attempts: 1 })
      .posts('blog', {})
      .catch((e: unknown) => e)) as TumblrApiError

    expect(JSON.stringify({ message: error.message, url: error.url })).not.toContain(KEY)
    expect(error.url).toContain('api_key=***')
  })

  it('is stripped from any URL', () => {
    expect(redact('https://api.tumblr.com/v2/blog/b/posts?api_key=abc&limit=20')).toBe(
      'https://api.tumblr.com/v2/blog/b/posts?api_key=***&limit=20',
    )
  })
})

describe('the request counter', () => {
  let instance: TumblrClient

  beforeEach(() => {
    const { fetch } = mockFetch([{ status: 500 }, { status: 500 }, { body: postsResponse([]) }])

    instance = client(fetch, { attempts: 5 })
  })

  afterEach(() => {
    expect(instance.requests).toBe(3)
  })

  it('counts retries too', async () => {
    await instance.posts('blog', {})
  })
})
