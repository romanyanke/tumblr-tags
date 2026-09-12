#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { HELP, parseCliArgs, UsageError } from './cli-args.js'
import { ConfigError } from './config.js'
import { TumblrAuthError, TumblrNotFoundError } from './errors.js'
import { createLogger } from './logger.js'
import { EXIT, runPost, runSync, runTags, SettingsError } from './run.js'

const version = async (): Promise<string> => {
  const path = new URL('../package.json', import.meta.url)
  const pkg = JSON.parse(await readFile(path, 'utf8')) as { version?: string }

  return pkg.version ?? '0.0.0'
}

const main = async (): Promise<number> => {
  const command = parseCliArgs(process.argv.slice(2))

  if (command.name === 'help') {
    process.stdout.write(`${HELP}\n`)

    return EXIT.ok
  }

  if (command.name === 'version') {
    process.stdout.write(`${await version()}\n`)

    return EXIT.ok
  }

  const logger = createLogger({ level: command.options.level, json: command.options.json })
  const controller = new AbortController()

  // Прерывание — дело CLI, а не библиотеки: снапшот и так пишется по контрольным точкам.
  const onSignal = () => {
    logger.endProgress()
    logger.error('прерывание: сохраняю собранное')
    controller.abort(new Error('SIGINT'))
  }

  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  const context = { logger, signal: controller.signal }

  try {
    switch (command.name) {
      case 'sync':
        return await runSync(command, context)
      case 'post':
        return await runPost(command, context)
      case 'tags':
        return await runTags(command, context)
    }
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
}

try {
  process.exitCode = await main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)

  process.stderr.write(`${message}\n`)

  if (error instanceof UsageError) {
    process.stderr.write(`\n${HELP}\n`)
    process.exitCode = EXIT.usage
  } else if (error instanceof ConfigError || error instanceof SettingsError) {
    process.exitCode = EXIT.usage
  } else if (error instanceof TumblrAuthError) {
    process.exitCode = EXIT.auth
  } else if (error instanceof TumblrNotFoundError) {
    process.exitCode = EXIT.notFound
  } else {
    process.exitCode = EXIT.failure
  }
}
