import { TumblrClient } from './client.js'
import { RequestBudgetExhausted, TumblrNotFoundError, TumblrRateLimitError } from './errors.js'
import { mergePosts, postIndex } from './snapshot/schema.js'
import type {
  PostId,
  RawPost,
  Snapshot,
  StopReason,
  SyncOptions,
  SyncProgress,
  SyncResult,
  TumblrCredentials,
} from './types.js'

const DEFAULTS = {
  maxRequests: 300,
  pageSize: 20,
  minRequestIntervalMs: 250,
} as const

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

interface Runner {
  client: TumblrClient
  throttle: () => Promise<void>
  report: (progress: Omit<SyncProgress, 'requests' | 'requestBudget'>) => void
  budget: number
}

const createRunner = (
  credentials: TumblrCredentials,
  options: SyncOptions,
  onRetryPhase: () => Omit<SyncProgress, 'requests' | 'requestBudget' | 'retry'>,
): Runner => {
  const budget = options.maxRequests ?? DEFAULTS.maxRequests
  const interval = options.minRequestIntervalMs ?? DEFAULTS.minRequestIntervalMs

  let last = 0
  let spent = 0

  const report: Runner['report'] = progress => {
    options.onProgress?.({ ...progress, requests: client.requests, requestBudget: budget })
  }

  const client = new TumblrClient({
    consumerKey: credentials.consumerKey,
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    ...(options.userAgent !== undefined ? { userAgent: options.userAgent } : {}),
    ...(options.retry !== undefined ? { retry: options.retry } : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    onRetry: info => report({ ...onRetryPhase(), phase: 'retry', retry: info }),
    // Retries spend the budget too, or a retrying run costs more than it promised.
    onRequest: () => {
      if (spent >= budget) {
        throw new RequestBudgetExhausted(budget)
      }

      spent++
    },
  })

  return {
    client,
    budget,
    report,
    throttle: async () => {
      const wait = last + interval - Date.now()

      if (wait > 0) {
        await sleep(wait)
      }

      last = Date.now()
    },
  }
}

/**
 * Pages of the blog's posts, newest first.
 *
 * The offset advances by the number of posts actually returned, not by the page
 * size asked for: if the API returns fewer, the crawl will not skip the rest.
 */
export async function* fetchPostPages(
  credentials: TumblrCredentials,
  options: SyncOptions = {},
): AsyncGenerator<{ posts: RawPost[]; totalPosts: number; offset: number }> {
  const pageSize = options.pageSize ?? DEFAULTS.pageSize
  const runner = createRunner(credentials, options, () => ({
    phase: 'page',
    postsSeen: 0,
    postsNew: 0,
    totalPosts: null,
  }))

  let offset = 0

  while (true) {
    await runner.throttle()

    const page = await runner.client.posts(credentials.blog, { limit: pageSize, offset })

    yield { ...page, offset }

    if (page.posts.length === 0 || offset + page.posts.length >= page.totalPosts) {
      return
    }

    offset += page.posts.length
  }
}

/**
 * Catches up with the blog: walks from newest posts to oldest and stops at the
 * first page the snapshot already holds in full.
 *
 * 1.x counted the offset from the end of the blog, so a post published during a
 * crawl shifted every remaining page and one post was lost. Walking newest-first
 * merely serves an already seen post in the same situation.
 */
export const syncSnapshot = async (
  credentials: TumblrCredentials,
  snapshot: Snapshot,
  options: SyncOptions = {},
): Promise<SyncResult> => {
  const pageSize = options.pageSize ?? DEFAULTS.pageSize
  const full = options.full ?? false

  let current: Snapshot = full
    ? { ...snapshot, posts: [], totalPosts: snapshot.totalPosts }
    : snapshot
  let known = postIndex(snapshot)
  let added = 0
  let updated = 0
  let seen = 0
  let totalPosts: number | null = null
  let stoppedBecause: StopReason | undefined
  let offset = 0

  const runner = createRunner(credentials, options, () => ({
    phase: 'page',
    postsSeen: seen,
    postsNew: added,
    totalPosts,
  }))

  try {
    while (true) {
      await runner.throttle()

      const page = await runner.client.posts(credentials.blog, { limit: pageSize, offset })

      totalPosts = page.totalPosts
      current = { ...current, totalPosts: page.totalPosts }

      if (page.posts.length === 0) {
        break
      }

      seen += page.posts.length

      const fresh = page.posts.filter(post => !known.has(post.id))
      const merged = mergePosts(current, page.posts)

      current = merged.snapshot
      added += merged.added
      updated += merged.updated
      known = postIndex(current)

      runner.report({ phase: 'page', postsSeen: seen, postsNew: added, totalPosts })
      await options.onCheckpoint?.(current)

      // A page made entirely of known posts — everything beyond it is older.
      if (!full && fresh.length === 0) {
        stoppedBecause = 'up-to-date'
        break
      }

      offset += page.posts.length

      if (offset >= page.totalPosts) {
        break
      }
    }
  } catch (error) {
    stoppedBecause = classifyStop(error, options.signal)

    if (stoppedBecause === undefined) {
      throw error
    }
  }

  current = { ...current, generatedAt: new Date().toISOString() }
  runner.report({ phase: 'done', postsSeen: seen, postsNew: added, totalPosts })

  return {
    snapshot: current,
    complete: current.posts.length >= current.totalPosts && stoppedBecause !== 'budget',
    requests: runner.client.requests,
    postsAdded: added,
    postsUpdated: updated,
    ...(stoppedBecause ? { stoppedBecause } : {}),
  }
}

/** Re-reads the named posts. Missing ones do not fail the run. */
export const syncPosts = async (
  credentials: TumblrCredentials,
  snapshot: Snapshot,
  postIds: readonly PostId[],
  options: Omit<SyncOptions, 'full' | 'pageSize'> = {},
): Promise<SyncResult> => {
  let current = snapshot
  let added = 0
  let updated = 0
  let seen = 0
  let stoppedBecause: StopReason | undefined
  const missingPosts: PostId[] = []

  const runner = createRunner(credentials, options, () => ({
    phase: 'post',
    postsSeen: seen,
    postsNew: added,
    totalPosts: current.totalPosts,
  }))

  try {
    // One at a time: 1.x fired every id at once and got a 429.
    for (const id of postIds) {
      await runner.throttle()

      let page: Awaited<ReturnType<TumblrClient['posts']>>

      try {
        page = await runner.client.posts(credentials.blog, { id })
      } catch (error) {
        if (error instanceof TumblrNotFoundError) {
          missingPosts.push(id)
          continue
        }

        throw error
      }

      const post = page.posts[0]

      if (!post) {
        missingPosts.push(id)
        continue
      }

      seen++

      const merged = mergePosts(current, [post])

      current = merged.snapshot
      added += merged.added
      updated += merged.updated

      runner.report({
        phase: 'post',
        postsSeen: seen,
        postsNew: added,
        totalPosts: current.totalPosts,
      })
      await options.onCheckpoint?.(current)
    }
  } catch (error) {
    stoppedBecause = classifyStop(error, options.signal)

    if (stoppedBecause === undefined) {
      throw error
    }
  }

  current = { ...current, generatedAt: new Date().toISOString() }
  runner.report({ phase: 'done', postsSeen: seen, postsNew: added, totalPosts: current.totalPosts })

  return {
    snapshot: current,
    complete: missingPosts.length === 0 && stoppedBecause === undefined,
    requests: runner.client.requests,
    postsAdded: added,
    postsUpdated: updated,
    ...(stoppedBecause ? { stoppedBecause } : {}),
    missingPosts,
  }
}

/**
 * A stop after which the collected data should be saved rather than thrown away.
 * Returns undefined when the error should propagate.
 */
const classifyStop = (error: unknown, signal?: AbortSignal): StopReason | undefined => {
  if (error instanceof RequestBudgetExhausted) {
    return 'budget'
  }

  if (error instanceof TumblrRateLimitError) {
    return 'rate-limit'
  }

  if (signal?.aborted) {
    return 'aborted'
  }

  return undefined
}
