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

const STOP_MESSAGE = {
  budget: 'request budget spent, snapshot saved — continue on the next run',
  'rate-limit': 'Tumblr rate limit reached, snapshot saved — continue later',
  aborted: 'run interrupted, snapshot saved — continue on the next run',
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
  /** Unset means the collect layer keeps its own default. */
  maxRequests: number | undefined
  pageSize: number | undefined
}

export class SettingsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SettingsError'
  }
}

/** Folds config, environment and flags into one. Flags win. */
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
    throw new SettingsError('No blog given: pass --blog or set blog in the config.')
  }

  if (requireKey && !consumerKey) {
    throw new SettingsError(
      'No access key: put it in TUMBLR_CONSUMER_KEY or in the config field consumerKey.',
    )
  }

  return {
    blog,
    consumerKey,
    snapshotPath: resolve(cwd, command.options.snapshot ?? config.snapshot ?? DEFAULT_SNAPSHOT),
    outPath: resolve(cwd, command.options.out ?? config.out ?? DEFAULT_OUT),
    minCount: command.options.minCount ?? config.minCount ?? 1,
    maxRequests: command.options.maxRequests ?? config.maxRequests,
    pageSize: command.options.pageSize ?? config.pageSize,
  }
}

const syncOptions = (command: CliCommand, context: RunContext, settings: Settings): SyncOptions => {
  const { options } = command
  const env = context.env ?? process.env
  // A seam for end-to-end tests: the live API address is swapped for a local server.
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
    ...(settings.maxRequests !== undefined ? { maxRequests: settings.maxRequests } : {}),
    ...(settings.pageSize !== undefined ? { pageSize: settings.pageSize } : {}),
    ...(retry ? { retry } : {}),
    ...(context.signal ? { signal: context.signal } : {}),
    onProgress: progress => reportProgress(progress, context.logger),
    // The snapshot is written after every page, so a break midway loses nothing.
    ...(options.dryRun
      ? {}
      : { onCheckpoint: (snapshot: Snapshot) => writeSnapshot(settings.snapshotPath, snapshot) }),
  }
}

const reportProgress = (progress: SyncProgress, logger: Logger): void => {
  if (progress.phase === 'retry' && progress.retry) {
    const { attempt, delayMs, reason } = progress.retry

    logger.detail(`retry ${attempt} in ${Math.round(delayMs / 1000)}s (${reason})`)
    logger.event('retry', { attempt, delayMs, reason })

    return
  }

  if (progress.phase === 'done') {
    logger.endProgress()

    return
  }

  const total = progress.totalPosts ?? '?'

  logger.progress(
    `posts ${progress.postsSeen}/${total} · new ${progress.postsNew} · requests ${progress.requests}/${progress.requestBudget}`,
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
    `${snapshot.posts.length} posts, ${snapshot.tags.length} tags · ` +
      `${result.postsAdded} new, ${result.postsUpdated} updated · ${result.requests} requests`,
  )

  if (result.missingPosts?.length) {
    logger.error(`posts not found: ${result.missingPosts.join(', ')}`)
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
    logger.info('dry run: nothing was written to disk')
  }

  // Any early stop means exit code 3: a CI wrapper must not take a run that was
  // preempted by SIGTERM for a successful one.
  if (result.stoppedBecause !== undefined && result.stoppedBecause !== 'up-to-date') {
    logger.error(STOP_MESSAGE[result.stoppedBecause])

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
    `blog ${settings.blog} · snapshot ${settings.snapshotPath} · ${snapshot.posts.length} posts cached`,
  )

  const result = await syncSnapshot(
    { blog: settings.blog, consumerKey: settings.consumerKey },
    snapshot,
    syncOptions(command, context, settings),
  )

  if (result.stoppedBecause === 'up-to-date' && result.postsAdded === 0) {
    context.logger.detail('no new posts')
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

/** Rebuilds the tag file from the snapshot. Needs no network — impossible in 1.x. */
export const runTags = async (command: CliCommand, context: RunContext): Promise<number> => {
  const settings = await resolveSettings(command, context, { requireKey: false })
  const existing = await readSnapshotIfExists(settings.snapshotPath)

  if (!existing) {
    throw new SettingsError(`Snapshot not found: ${settings.snapshotPath}. Run ttags first.`)
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
    `${counts.length} tags from ${snapshot.posts.length} posts → ${settings.outPath}`,
  )
  context.logger.event('done', { tags: counts.length, posts: snapshot.posts.length })

  return EXIT.ok
}
