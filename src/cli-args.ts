import { parseArgs } from 'node:util'

export type CommandName = 'sync' | 'post' | 'tags' | 'help' | 'version'

export interface CliCommand {
  name: CommandName
  postIds: string[]
  options: {
    config?: string
    blog?: string
    snapshot?: string
    out?: string
    minCount?: number
    maxRequests?: number
    pageSize?: number
    timeout?: number
    retries?: number
    full: boolean
    compact: boolean
    dryRun: boolean
    json: boolean
    level: 'quiet' | 'normal' | 'verbose'
    writeTags: boolean
  }
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

export const HELP = `ttags — теги постов Tumblr-блога

Использование:
  ttags [sync] [опции]        обойти блог и обновить снапшот (команда по умолчанию)
  ttags post <id...>          перечитать названные посты
  ttags tags [опции]          пересобрать файл тегов из снапшота, без обращений к сети
  ttags --help | --version

Опции:
  -c, --config <path>    путь к конфигу (по умолчанию ttags.config.* в текущем каталоге)
      --blog <name>      имя блога, перекрывает конфиг
      --snapshot <file>  файл снапшота (по умолчанию tmp/source.json)
      --out <file>       файл с тегами (по умолчанию dist/tags.json)
      --min-count <n>    отбросить теги реже, чем в n постах (по умолчанию 1)
      --max-requests <n> потолок запросов за прогон (по умолчанию 300)
      --page-size <n>    постов в запросе (по умолчанию 20)
      --timeout <ms>     таймаут запроса (по умолчанию 15000)
      --retries <n>      попыток на запрос (по умолчанию 5)
      --full             обойти блог целиком, не останавливаясь на известных постах
      --compact          убрать неиспользуемые теги и уплотнить их номера
      --dry-run          ничего не записывать на диск
      --no-tags          не пересобирать файл тегов
      --json             события построчным JSON в stdout
  -q, --quiet            только ошибки
  -v, --verbose          подробный вывод

Ключ доступа берётся из TUMBLR_CONSUMER_KEY или из конфига.

Коды выхода:
  0  успех            2  ошибка в аргументах   4  отказ авторизации
  1  ошибка            3  синхронизация неполная 5  блог не найден`

const toNumber = (value: string | undefined, flag: string): number | undefined => {
  if (value === undefined) {
    return undefined
  }

  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new UsageError(`Опция ${flag} ожидает неотрицательное число, получено "${value}".`)
  }

  return parsed
}

export const parseCliArgs = (argv: readonly string[]): CliCommand => {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>

  try {
    parsed = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true })
  } catch (error) {
    // parseArgs бросает голый TypeError — без этого пользователь увидит стектрейс.
    throw new UsageError((error as Error).message)
  }

  const { values, positionals } = parsed
  const [first, ...rest] = positionals

  const numbers = {
    minCount: toNumber(values['min-count'], '--min-count'),
    maxRequests: toNumber(values['max-requests'], '--max-requests'),
    pageSize: toNumber(values['page-size'], '--page-size'),
    timeout: toNumber(values.timeout, '--timeout'),
    retries: toNumber(values.retries, '--retries'),
  }

  const options: CliCommand['options'] = {
    full: values.full ?? false,
    compact: values.compact ?? false,
    dryRun: values['dry-run'] ?? false,
    json: values.json ?? false,
    level: values.quiet ? 'quiet' : values.verbose ? 'verbose' : 'normal',
    writeTags: !(values['no-tags'] ?? false),
  }

  for (const key of ['config', 'blog', 'snapshot', 'out'] as const) {
    const value = values[key]

    if (value !== undefined) {
      options[key] = value
    }
  }

  for (const [key, value] of Object.entries(numbers)) {
    if (value !== undefined) {
      options[key as keyof typeof numbers] = value
    }
  }

  if (values.help) {
    return { name: 'help', postIds: [], options }
  }

  if (values.version) {
    return { name: 'version', postIds: [], options }
  }

  if (first === undefined || first === 'sync') {
    return { name: 'sync', postIds: [], options }
  }

  if (first === 'tags') {
    return { name: 'tags', postIds: [], options }
  }

  if (first === 'post') {
    if (rest.length === 0) {
      throw new UsageError('Команде post нужен хотя бы один идентификатор поста.')
    }

    for (const id of rest) {
      if (!/^\d+$/.test(id)) {
        throw new UsageError(`Идентификатор поста должен состоять из цифр, получено "${id}".`)
      }
    }

    return { name: 'post', postIds: rest, options }
  }

  throw new UsageError(`Неизвестная команда: ${first}`)
}

const OPTIONS = {
  config: { type: 'string', short: 'c' },
  blog: { type: 'string' },
  snapshot: { type: 'string' },
  out: { type: 'string' },
  'min-count': { type: 'string' },
  'max-requests': { type: 'string' },
  'page-size': { type: 'string' },
  timeout: { type: 'string' },
  retries: { type: 'string' },
  full: { type: 'boolean' },
  compact: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  'no-tags': { type: 'boolean' },
  json: { type: 'boolean' },
  quiet: { type: 'boolean', short: 'q' },
  verbose: { type: 'boolean', short: 'v' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean' },
} as const
