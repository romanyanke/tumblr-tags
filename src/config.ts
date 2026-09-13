import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface TtagsConfig {
  blog?: string
  consumerKey?: string
  snapshot?: string
  out?: string
  minCount?: number
  maxRequests?: number
  pageSize?: number
}

/** Names looked up in the current directory when no path is given. */
const CANDIDATES = ['ttags.config.js', 'ttags.config.mjs', 'ttags.config.cjs', 'ttags.config.json']

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

const loadFile = async (path: string): Promise<unknown> => {
  if (path.endsWith('.json')) {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  }

  // import() respects the project's "type", so both export default and module.exports work.
  const module = (await import(pathToFileURL(path).href)) as { default?: unknown }

  return module.default ?? module
}

const pick = (source: Record<string, unknown>): TtagsConfig => {
  const config: TtagsConfig = {}

  for (const key of ['blog', 'consumerKey', 'snapshot', 'out'] as const) {
    const value = source[key]

    if (typeof value === 'string') {
      config[key] = value
    }
  }

  for (const key of ['minCount', 'maxRequests', 'pageSize'] as const) {
    const value = source[key]

    if (typeof value === 'number') {
      config[key] = value
    }
  }

  return config
}

/**
 * Reads the config: an explicit path, then ttags.config.* in the current directory,
 * then the "ttags" field in package.json. Nothing found means an empty config.
 *
 * Unlike 1.x we never walk up the directory tree: there paths were resolved against
 * the package.json that was found, so running from a subdirectory wrote files into
 * the parent directory.
 */
export const loadConfig = async (
  explicitPath?: string,
  cwd = process.cwd(),
): Promise<TtagsConfig> => {
  if (explicitPath) {
    const path = isAbsolute(explicitPath) ? explicitPath : resolve(cwd, explicitPath)

    try {
      const loaded = await loadFile(path)

      if (typeof loaded !== 'object' || loaded === null) {
        throw new ConfigError(`Config "${explicitPath}" must export an object.`)
      }

      return pick(loaded as Record<string, unknown>)
    } catch (error) {
      if (error instanceof ConfigError) {
        throw error
      }

      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ConfigError(`Config not found: ${explicitPath}`)
      }

      throw new ConfigError(`Could not read config "${explicitPath}": ${(error as Error).message}`)
    }
  }

  for (const name of CANDIDATES) {
    try {
      const loaded = await loadFile(resolve(cwd, name))

      if (typeof loaded === 'object' && loaded !== null) {
        return pick(loaded as Record<string, unknown>)
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code

      if (code !== 'ENOENT' && code !== 'ERR_MODULE_NOT_FOUND') {
        throw new ConfigError(`Could not read config "${name}": ${(error as Error).message}`)
      }
    }
  }

  try {
    const pkg = JSON.parse(await readFile(resolve(cwd, 'package.json'), 'utf8')) as {
      ttags?: Record<string, unknown>
    }

    if (pkg.ttags) {
      return pick(pkg.ttags)
    }
  } catch {
    // A neighbouring package.json is optional.
  }

  return {}
}
