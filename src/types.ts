/** Версия схемы файла снапшота. Читатель обязан её проверять. */
export const SNAPSHOT_SCHEMA_VERSION = 2

/** Индекс тега в `Snapshot.tags`. Он же — идентификатор тега. */
export type TagId = number

/** `id_string` поста. Всегда строка: идентификаторы Tumblr доходят до 18 знаков. */
export type PostId = string

export interface SnapshotPost {
  id: PostId
  /** Unix-секунды — время публикации поста по данным Tumblr. */
  timestamp: number
  /** Идентификаторы тегов без повторов, в порядке появления на посте. */
  tags: TagId[]
}

/**
 * Полный слепок блога.
 *
 * В отличие от кеша 1.x это документированный контракт, а не внутренний файл:
 * его читают и потребители пакета.
 */
export interface Snapshot {
  schema: typeof SNAPSHOT_SCHEMA_VERSION
  blog: string
  /** ISO-8601, момент последней успешной синхронизации. */
  generatedAt: string
  /** `total_posts`, как его вернул API при последней синхронизации. */
  totalPosts: number
  /** Имена тегов. Индекс элемента и есть его `TagId`, дыр не бывает. */
  tags: string[]
  /** Новые сверху — в том порядке, в каком их отдаёт API. */
  posts: SnapshotPost[]
}

/** Пост, каким его вернул Tumblr, до укладки в снапшот. */
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
  /** `me-yanke` или `me-yanke.tumblr.com` — годится и то, и другое. */
  blog: string
  consumerKey: string
}

export type RetryReason = 'network' | 'timeout' | 'empty-body' | 'rate-limit' | 'server'

export interface RetryPolicy {
  /** Попыток на запрос, включая первую. */
  attempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  /** Таймаут одного запроса. */
  timeoutMs?: number
  /** Доля случайной добавки к задержке, 0..1. */
  jitter?: number
  /**
   * Сколько ждать, если 429 назвал время сброса. По умолчанию 0 — не ждать:
   * часовое окно Tumblr означает, что сброс может быть через час.
   */
  maxRateLimitWaitMs?: number
}

export type SyncPhase = 'page' | 'post' | 'retry' | 'done'

export interface SyncProgress {
  phase: SyncPhase
  /** Запросов потрачено за прогон, включая повторы. */
  requests: number
  requestBudget: number
  postsSeen: number
  postsNew: number
  /** null до первого ответа API. */
  totalPosts: number | null
  retry?: { attempt: number; delayMs: number; reason: RetryReason }
}

export type StopReason = 'budget' | 'aborted' | 'up-to-date' | 'rate-limit'

export interface SyncOptions {
  /** Обойти блог целиком, не останавливаясь на известных постах. */
  full?: boolean
  /** Потолок HTTP-запросов на прогон. */
  maxRequests?: number
  /** Постов на страницу. */
  pageSize?: number
  /** Минимальный интервал между запросами. */
  minRequestIntervalMs?: number
  signal?: AbortSignal
  onProgress?: (progress: SyncProgress) => void
  /** Зовётся после каждой смёрдженной страницы — сюда CLI вешает запись на диск. */
  onCheckpoint?: (snapshot: Snapshot) => void | Promise<void>
  retry?: RetryPolicy
  userAgent?: string
  /** Шов для тестов и для нестандартного транспорта. */
  fetch?: typeof globalThis.fetch
  /** Шов для тестов: база API без хвостового слеша. */
  baseUrl?: string
}

export interface SyncResult {
  snapshot: Snapshot
  /** `posts.length === totalPosts` на конец прогона. */
  complete: boolean
  requests: number
  postsAdded: number
  postsUpdated: number
  /** Заполнено, если прогон кончился раньше, чем блог. */
  stoppedBecause?: StopReason
  /** Только для `syncPosts`: идентификаторы, которых в блоге нет. */
  missingPosts?: PostId[]
}

export interface CountOptions {
  /** Отбросить теги, встречающиеся меньше чем в стольких постах. */
  minCount?: number
  sort?: 'name' | 'count'
  locale?: string | string[]
}
