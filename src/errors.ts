/** Ошибка обращения к Tumblr API. Конверт ответа сохраняется для диагностики. */
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

/** 401 или 403: неверный или отозванный consumer key. Повторять бессмысленно. */
export class TumblrAuthError extends TumblrApiError {
  constructor(
    message: string,
    options: { status: number; url: string; meta?: { status: number; msg: string } },
  ) {
    super(message, options)
    this.name = 'TumblrAuthError'
  }
}

/** 404 на блог. */
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
 * 429. `resetInSeconds` — время до сброса окна, если API его назвал;
 * у часового окна это может быть до 3600 секунд.
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

/** Файл снапшота написан другой версией пакета. */
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

/** Бюджет запросов на прогон исчерпан. Наружу не выходит — останавливает обход. */
export class RequestBudgetExhausted extends Error {
  constructor(budget: number) {
    super(`Бюджет запросов исчерпан: ${budget}`)
    this.name = 'RequestBudgetExhausted'
  }
}
