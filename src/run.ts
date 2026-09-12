import { resolve } from 'node:path'
import { countTags } from './aggregate.js'
import type { CliCommand } from './cli-args.js'
import { syncPosts, syncSnapshot } from './collect.js'
import { loadConfig } from './config.js'
import type { Logger } from './logger.js'
import { readSnapshotIfExists, writeSnapshot, writeTagCounts } from './snapshot/io.js'
import { compactTags } from './snapshot/ops.js'
import { emptySnapshot } from './snapshot/schema.js'
import type { Snapshot, SyncOptions, SyncProgress, SyncResult } from './types.js'

export const EXIT = {
  ok: 0,
  failure: 1,
  usage: 2,
  incomplete: 3,
  auth: 4,
  notFound: 5,
} as const

const DEFAULT_SNAPSHOT = 'tmp/source.json'
const DEFAULT_OUT = 'dist/tags.json'

export interface RunContext {
  logger: Logger
  cwd?: string
  signal?: AbortSignal
  env?: NodeJS.ProcessEnv
}

export interface Settings {
  blog: string
  consumerKey: string
  snapshotPath: string
  outPath: string
  minCount: number
}

export class SettingsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SettingsError'
  }
}

/** Сводит конфиг, переменные окружения и флаги в одно. Флаги главнее. */
export const resolveSettings = async (
  command: CliCommand,
  context: RunContext,
  { requireKey }: { requireKey: boolean },
): Promise<Settings> => {
  const cwd = context.cwd ?? process.cwd()
  const env = context.env ?? process.env
  const config = await loadConfig(command.options.config, cwd)

  const blog = command.options.blog ?? config.blog
  const consumerKey = env.TUMBLR_CONSUMER_KEY ?? config.consumerKey ?? ''

  if (!blog) {
    throw new SettingsError('Не задан блог: укажите --blog или поле blog в конфиге.')
  }

  if (requireKey && !consumerKey) {
    throw new SettingsError(
      'Не задан ключ доступа: положите его в TUMBLR_CONSUMER_KEY или в поле consumerKey конфига.',
    )
  }

  return {
    blog,
    consumerKey,
    snapshotPath: resolve(cwd, command.options.snapshot ?? config.snapshot ?? DEFAULT_SNAPSHOT),
    outPath: resolve(cwd, command.options.out ?? config.out ?? DEFAULT_OUT),
    minCount: command.options.minCount ?? config.minCount ?? 1,
  }
}

const syncOptions = (command: CliCommand, context: RunContext, settings: Settings): SyncOptions => {
  const { options } = command
  const env = context.env ?? process.env
  // Шов для сквозных тестов: боевой адрес API подменяется на локальный сервер.
  const baseUrl = env.TTAGS_API_BASE
  const retry =
    options.retries !== undefined || options.timeout !== undefined
      ? {
          ...(options.retries !== undefined ? { attempts: options.retries } : {}),
          ...(options.timeout !== undefined ? { timeoutMs: options.timeout } : {}),
        }
      : undefined

  return {
    full: options.full,
    ...(baseUrl ? { baseUrl } : {}),
    ...(options.maxRequests !== undefined ? { maxRequests: options.maxRequests } : {}),
    ...(options.pageSize !== undefined ? { pageSize: options.pageSize } : {}),
    ...(retry ? { retry } : {}),
    ...(context.signal ? { signal: context.signal } : {}),
    onProgress: progress => reportProgress(progress, context.logger),
    // Снапшот пишется после каждой страницы: обрыв на середине не теряет прогон.
    ...(options.dryRun
      ? {}
      : { onCheckpoint: (snapshot: Snapshot) => writeSnapshot(settings.snapshotPath, snapshot) }),
  }
}

const reportProgress = (progress: SyncProgress, logger: Logger): void => {
  if (progress.phase === 'retry' && progress.retry) {
    const { attempt, delayMs, reason } = progress.retry

    logger.detail(`повтор ${attempt} через ${Math.round(delayMs / 1000)} с (${reason})`)
    logger.event('retry', { attempt, delayMs, reason })

    return
  }

  if (progress.phase === 'done') {
    logger.endProgress()

    return
  }

  const total = progress.totalPosts ?? '?'

  logger.progress(
    `посты ${progress.postsSeen}/${total} · новых ${progress.postsNew} · запросы ${progress.requests}/${progress.requestBudget}`,
  )
  logger.event('progress', {
    phase: progress.phase,
    postsSeen: progress.postsSeen,
    postsNew: progress.postsNew,
    requests: progress.requests,
  })
}

const finish = async (
  result: SyncResult,
  command: CliCommand,
  context: RunContext,
  settings: Settings,
): Promise<number> => {
  const { logger } = context
  const snapshot = command.options.compact ? compactTags(result.snapshot) : result.snapshot

  if (!command.options.dryRun) {
    await writeSnapshot(settings.snapshotPath, snapshot)

    if (command.options.writeTags) {
      await writeTagCounts(settings.outPath, countTags(snapshot, { minCount: settings.minCount }))
    }
  }

  logger.endProgress()
  logger.info(
    `${snapshot.posts.length} постов, ${snapshot.tags.length} тегов · ` +
      `новых ${result.postsAdded}, обновлено ${result.postsUpdated} · запросов ${result.requests}`,
  )

  if (result.missingPosts?.length) {
    logger.error(`не найдены посты: ${result.missingPosts.join(', ')}`)
  }

  logger.event('done', {
    posts: snapshot.posts.length,
    tags: snapshot.tags.length,
    added: result.postsAdded,
    updated: result.postsUpdated,
    requests: result.requests,
    complete: result.complete,
    ...(result.stoppedBecause ? { stoppedBecause: result.stoppedBecause } : {}),
  })

  if (command.options.dryRun) {
    logger.info('сухой прогон: на диск ничего не записано')
  }

  if (result.stoppedBecause === 'budget' || result.stoppedBecause === 'rate-limit') {
    logger.error(
      result.stoppedBecause === 'budget'
        ? 'бюджет запросов исчерпан, снапшот сохранён — продолжите следующим прогоном'
        : 'лимит запросов Tumblr исчерпан, снапшот сохранён — продолжите позже',
    )

    return EXIT.incomplete
  }

  if (result.missingPosts?.length) {
    return EXIT.incomplete
  }

  return EXIT.ok
}

export const runSync = async (command: CliCommand, context: RunContext): Promise<number> => {
  const settings = await resolveSettings(command, context, { requireKey: true })
  const existing = await readSnapshotIfExists(settings.snapshotPath)
  const snapshot = existing ?? emptySnapshot(settings.blog)

  context.logger.detail(
    `блог ${settings.blog} · снапшот ${settings.snapshotPath} · в кеше ${snapshot.posts.length} постов`,
  )

  const result = await syncSnapshot(
    { blog: settings.blog, consumerKey: settings.consumerKey },
    snapshot,
    syncOptions(command, context, settings),
  )

  if (result.stoppedBecause === 'up-to-date' && result.postsAdded === 0) {
    context.logger.detail('новых постов нет')
  }

  return finish(result, command, context, settings)
}

export const runPost = async (command: CliCommand, context: RunContext): Promise<number> => {
  const settings = await resolveSettings(command, context, { requireKey: true })
  const existing = await readSnapshotIfExists(settings.snapshotPath)
  const snapshot = existing ?? emptySnapshot(settings.blog)

  const result = await syncPosts(
    { blog: settings.blog, consumerKey: settings.consumerKey },
    snapshot,
    command.postIds,
    syncOptions(command, context, settings),
  )

  return finish(result, command, context, settings)
}

/** Пересобирает файл тегов из снапшота. Сети не требует — в 1.x так было нельзя. */
export const runTags = async (command: CliCommand, context: RunContext): Promise<number> => {
  const settings = await resolveSettings(command, context, { requireKey: false })
  const existing = await readSnapshotIfExists(settings.snapshotPath)

  if (!existing) {
    throw new SettingsError(`Снапшот не найден: ${settings.snapshotPath}. Запустите ttags.`)
  }

  const snapshot = command.options.compact ? compactTags(existing) : existing
  const counts = countTags(snapshot, { minCount: settings.minCount })

  if (!command.options.dryRun) {
    await writeTagCounts(settings.outPath, counts)

    if (command.options.compact) {
      await writeSnapshot(settings.snapshotPath, snapshot)
    }
  }

  context.logger.info(
    `${counts.length} тегов из ${snapshot.posts.length} постов → ${settings.outPath}`,
  )
  context.logger.event('done', { tags: counts.length, posts: snapshot.posts.length })

  return EXIT.ok
}
