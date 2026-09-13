/** Schema version of the snapshot file. Readers must check it. */
export const SNAPSHOT_SCHEMA_VERSION = 2

/** Index of a tag in `Snapshot.tags`. It is also the tag's identifier. */
export type TagId = number

/** A post's `id_string`. Always a string: Tumblr ids reach 18 digits. */
export type PostId = string

export interface SnapshotPost {
  id: PostId
  /** Unix seconds — when Tumblr says the post was published. */
  timestamp: number
  /** Tag ids without duplicates, in the order they appear on the post. */
  tags: TagId[]
}

/**
 * A full picture of the blog.
 *
 * Unlike the 1.x cache this is a documented contract rather than an internal
 * file: consumers of the package read it too.
 */
export interface Snapshot {
  schema: typeof SNAPSHOT_SCHEMA_VERSION
  blog: string
  /** ISO-8601 timestamp of the last successful sync. */
  generatedAt: string
  /** `total_posts` as the API reported it during the last sync. */
  totalPosts: number
  /** Tag names. An element's index is its `TagId`, and there are never gaps. */
  tags: string[]
  /** Newest first — the order the API returns them in. */
  posts: SnapshotPost[]
}

/** A post as Tumblr returned it, before it goes into the snapshot. */
export interface RawPost {
  id: PostId
  timestamp: number
  tags: string[]
}

export interface TagCount {
  tag: string
  count: number
}

export interface TumblrCredentials {
  /** Either `me-yanke` or `me-yanke.tumblr.com` works. */
  blog: string
  consumerKey: string
}

export type RetryReason = 'network' | 'timeout' | 'empty-body' | 'rate-limit' | 'server'

export interface RetryPolicy {
  /** Attempts per request, including the first one. */
  attempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  /** Timeout for a single request. */
  timeoutMs?: number
  /** Share of random padding added to each delay, 0..1. */
  jitter?: number
  /**
   * How long to wait when a 429 names its reset time. Zero by default — do not
   * wait: Tumblr's hourly window can be up to an hour away.
   */
  maxRateLimitWaitMs?: number
}

export type SyncPhase = 'page' | 'post' | 'retry' | 'done'

export interface SyncProgress {
  phase: SyncPhase
  /** Requests spent during this run, retries included. */
  requests: number
  requestBudget: number
  postsSeen: number
  postsNew: number
  /** Null until the API answers for the first time. */
  totalPosts: number | null
  retry?: { attempt: number; delayMs: number; reason: RetryReason }
}

export type StopReason = 'budget' | 'aborted' | 'up-to-date' | 'rate-limit'

export interface SyncOptions {
  /** Crawl the whole blog instead of stopping at posts already known. */
  full?: boolean
  /** Ceiling on HTTP requests for one run. */
  maxRequests?: number
  /** Posts per page. */
  pageSize?: number
  /** Minimum gap between requests. */
  minRequestIntervalMs?: number
  signal?: AbortSignal
  onProgress?: (progress: SyncProgress) => void
  /** Called after every merged page — this is where the CLI writes to disk. */
  onCheckpoint?: (snapshot: Snapshot) => void | Promise<void>
  retry?: RetryPolicy
  userAgent?: string
  /** A seam for tests and for a non-standard transport. */
  fetch?: typeof globalThis.fetch
  /** A seam for tests: API base without a trailing slash. */
  baseUrl?: string
}

export interface SyncResult {
  snapshot: Snapshot
  /** `posts.length === totalPosts` when the run ended. */
  complete: boolean
  requests: number
  postsAdded: number
  postsUpdated: number
  /** Set when the run ended before the blog did. */
  stoppedBecause?: StopReason
  /** `syncPosts` only: ids the blog does not have. */
  missingPosts?: PostId[]
}

export interface CountOptions {
  /** Drop tags used in fewer than this many posts. */
  minCount?: number
  sort?: 'name' | 'count'
  locale?: string | string[]
}
