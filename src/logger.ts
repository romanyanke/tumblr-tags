/* biome-ignore-all lint/suspicious/noConsole: the only place the CLI prints. */

export type LogLevel = 'quiet' | 'normal' | 'verbose'

export interface Logger {
  info: (message: string) => void
  detail: (message: string) => void
  error: (message: string) => void
  /** A rewritable progress line; stays silent outside a TTY so CI logs stay clean. */
  progress: (message: string) => void
  endProgress: () => void
  event: (name: string, payload: Record<string, unknown>) => void
}

export interface LoggerOptions {
  level?: LogLevel
  /** NDJSON on stdout instead of human-readable output. */
  json?: boolean
  stream?: NodeJS.WriteStream
}

export const createLogger = ({
  level = 'normal',
  json = false,
  stream,
}: LoggerOptions = {}): Logger => {
  const out = stream ?? process.stderr
  const isTty = Boolean(out.isTTY)

  let progressOpen = false

  const write = (message: string) => {
    if (progressOpen) {
      out.write('\n')
      progressOpen = false
    }

    out.write(`${message}\n`)
  }

  return {
    info: message => {
      if (level !== 'quiet' && !json) {
        write(message)
      }
    },
    detail: message => {
      if (level === 'verbose' && !json) {
        write(message)
      }
    },
    error: message => {
      if (!json) {
        write(message)
      }
    },
    progress: message => {
      if (level === 'quiet' || json) {
        return
      }

      if (isTty) {
        out.write(`\r${message}`)
        progressOpen = true
      }
    },
    endProgress: () => {
      if (progressOpen) {
        out.write('\n')
        progressOpen = false
      }
    },
    event: (name, payload) => {
      if (json) {
        console.log(JSON.stringify({ event: name, ...payload }))
      }
    },
  }
}
