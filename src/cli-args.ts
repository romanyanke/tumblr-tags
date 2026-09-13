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

export const HELP = `ttags — tags from the posts of a Tumblr blog

Usage:
  ttags [sync] [options]      crawl the blog and update the snapshot (default command)
  ttags post <id...>          re-read the named posts
  ttags tags [options]        rebuild the tag file from the snapshot, without the network
  ttags --help | --version

Options:
  -c, --config <path>    config file (default: ttags.config.* in the current directory)
      --blog <name>      blog name, overrides the config
      --snapshot <file>  snapshot file (default: tmp/source.json)
      --out <file>       tag file (default: dist/tags.json)
      --min-count <n>    drop tags used in fewer than n posts (default: 1)
      --max-requests <n> request ceiling for one run (default: 300)
      --page-size <n>    posts per request (default: 20)
      --timeout <ms>     per-request timeout (default: 15000)
      --retries <n>      attempts per request (default: 5)
      --full             crawl everything, do not stop at known posts
      --compact          drop unused tags and renumber the rest
      --dry-run          write nothing to disk
      --no-tags          do not rebuild the tag file
      --json             newline-delimited JSON events on stdout
  -q, --quiet            errors only
  -v, --verbose          verbose output

The access key comes from TUMBLR_CONSUMER_KEY or from the config.

Exit codes:
  0  done              2  bad arguments        4  authorization refused
  1  error             3  incomplete run       5  blog not found`

const toNumber = (value: string | undefined, flag: string): number | undefined => {
  if (value === undefined) {
    return undefined
  }

  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new UsageError(`Option ${flag} expects a non-negative number, got "${value}".`)
  }

  return parsed
}

export const parseCliArgs = (argv: readonly string[]): CliCommand => {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>

  try {
    parsed = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true })
  } catch (error) {
    // parseArgs throws a bare TypeError — without this the user would see a stack trace.
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
      throw new UsageError('The post command needs at least one post id.')
    }

    for (const id of rest) {
      if (!/^\d+$/.test(id)) {
        throw new UsageError(`A post id must be digits only, got "${id}".`)
      }
    }

    return { name: 'post', postIds: rest, options }
  }

  throw new UsageError(`Unknown command: ${first}`)
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
