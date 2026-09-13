/** A failed call to the Tumblr API. The response envelope is kept for diagnostics. */
export class TumblrApiError extends Error {
  readonly status: number
  readonly meta: { status: number; msg: string } | undefined
  readonly url: string

  constructor(
    message: string,
    options: { status: number; url: string; meta?: { status: number; msg: string } },
  ) {
    super(message)
    this.name = 'TumblrApiError'
    this.status = options.status
    this.url = options.url
    this.meta = options.meta
  }
}

/** 401 or 403: the consumer key is wrong or revoked. Retrying is pointless. */
export class TumblrAuthError extends TumblrApiError {
  constructor(
    message: string,
    options: { status: number; url: string; meta?: { status: number; msg: string } },
  ) {
    super(message, options)
    this.name = 'TumblrAuthError'
  }
}

/** 404 for the blog. */
export class TumblrNotFoundError extends TumblrApiError {
  constructor(
    message: string,
    options: { status: number; url: string; meta?: { status: number; msg: string } },
  ) {
    super(message, options)
    this.name = 'TumblrNotFoundError'
  }
}

/**
 * 429. `resetInSeconds` is how long until the window resets, when the API says
 * so; for the hourly window that can be up to 3600 seconds.
 */
export class TumblrRateLimitError extends TumblrApiError {
  readonly resetInSeconds: number | undefined
  readonly scope: 'hour' | 'day' | undefined

  constructor(
    message: string,
    options: {
      status: number
      url: string
      meta?: { status: number; msg: string }
      resetInSeconds?: number
      scope?: 'hour' | 'day'
    },
  ) {
    super(message, options)
    this.name = 'TumblrRateLimitError'
    this.resetInSeconds = options.resetInSeconds
    this.scope = options.scope
  }
}

/** The snapshot file was written by a different version of the package. */
export class SnapshotSchemaError extends Error {
  readonly found: unknown
  readonly expected: number

  constructor(message: string, options: { found: unknown; expected: number }) {
    super(message)
    this.name = 'SnapshotSchemaError'
    this.found = options.found
    this.expected = options.expected
  }
}

/** The per-run request budget is spent. Never escapes — it stops the crawl. */
export class RequestBudgetExhausted extends Error {
  constructor(budget: number) {
    super(`Request budget exhausted: ${budget}`)
    this.name = 'RequestBudgetExhausted'
  }
}
