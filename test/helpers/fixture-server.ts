import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface FixtureServer {
  url: string
  requests: string[]
  /** Зовётся на каждый запрос — чтобы тест мог вмешаться в идущий прогон. */
  onRequest?: (path: string) => void
  close: () => Promise<void>
}

/**
 * Локальная подделка api.tumblr.com для e2e: CLI запускается настоящим процессом,
 * поэтому мок fetch до него не дотянется — нужен живой адрес.
 */
export const startFixtureServer = async (
  handler: (
    url: URL,
    index: number,
  ) => { status?: number; body?: unknown; raw?: string; headers?: Record<string, string> },
): Promise<FixtureServer> => {
  const requests: string[] = []

  const fixture = { requests } as FixtureServer

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const result = handler(url, requests.length)

    requests.push(url.pathname + url.search)
    fixture.onRequest?.(url.pathname + url.search)

    res.writeHead(result.status ?? 200, {
      'content-type': 'application/json',
      ...result.headers,
    })
    res.end(result.raw ?? JSON.stringify(result.body ?? { meta: { status: 200 }, response: {} }))
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))

  const { port } = server.address() as AddressInfo

  return Object.assign(fixture, {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()))
      }),
  })
}
