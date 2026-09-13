import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface FixtureServer {
  url: string
  requests: string[]
  /** Called on every request so a test can interfere with a running crawl. */
  onRequest?: (path: string) => void
  close: () => Promise<void>
}

/**
 * A local stand-in for api.tumblr.com: the end-to-end tests run the CLI as a real
 * process, so a fetch mock cannot reach it — it needs a real address.
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
