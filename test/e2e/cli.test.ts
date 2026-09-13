import { execFile, spawn } from 'node:child_process'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { startFixtureServer } from '../helpers/fixture-server.js'
import { postsResponse } from '../helpers/mock-fetch.js'
import { tempDir } from '../helpers/tmp-dir.js'

const run = promisify(execFile)
const CLI = fileURLToPath(new URL('../../dist/cli.js', import.meta.url))

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

const ttags = async (
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): Promise<RunResult> => {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...process.env, TUMBLR_CONSUMER_KEY: 'test-key', ...env },
    })

    return { code: 0, stdout, stderr }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }

    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

const posts = (ids: string[], total = ids.length) =>
  postsResponse(
    ids.map(id => ({ id, timestamp: Number(id), tags: ['cat', `tag-${id}`] })),
    total,
  )

describe('ttags', () => {
  it('is executable straight from dist', async () => {
    // tsc emits 0644, so the build has to set the bit itself. Installing from
    // the registry hides this — npm fixes bin permissions when it links — but a
    // file: install or running ./dist/cli.js directly does not.
    const { mode } = await stat(CLI)

    expect(
      mode & 0o111,
      `dist/cli.js is not executable (mode ${(mode & 0o777).toString(8)})`,
    ).not.toBe(0)

    const direct = await run(CLI, ['--version'])

    expect(direct.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('prints help and exits zero', async () => {
    const result = await ttags(['--help'], await tempDir())

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('ttags')
    expect(result.stdout).toContain('--max-requests')
  })

  it('prints the version', async () => {
    const result = await ttags(['--version'], await tempDir())

    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('exits 2 on an unknown flag and shows the help', async () => {
    const result = await ttags(['--no-such-flag'], await tempDir())

    expect(result.code).toBe(2)
    expect(result.stderr).toContain('ttags')
  })

  it('exits 2 without a blog', async () => {
    const result = await ttags([], await tempDir())

    expect(result.code).toBe(2)
    expect(result.stderr).toContain('blog')
  })

  it('exits 2 without an access key', async () => {
    const result = await ttags(['--blog', 'b'], await tempDir(), { TUMBLR_CONSUMER_KEY: '' })

    expect(result.code).toBe(2)
    expect(result.stderr).toContain('key')
  })

  it('crawls the blog and writes the snapshot and the tag file', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer(() => ({ body: posts(['3', '2', '1']) }))

    try {
      const result = await ttags(['--blog', 'my-blog'], dir, { TTAGS_API_BASE: server.url })

      expect(result.code).toBe(0)

      const snapshot = JSON.parse(await readFile(join(dir, 'tmp/source.json'), 'utf8'))
      const tags = JSON.parse(await readFile(join(dir, 'dist/tags.json'), 'utf8'))

      expect(snapshot.schema).toBe(2)
      expect(snapshot.posts.map((post: { id: string }) => post.id)).toEqual(['3', '2', '1'])
      expect(tags).toContainEqual({ tag: 'cat', count: 3 })
    } finally {
      await server.close()
    }
  })

  it('sees on a second run that everything is already collected', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer(() => ({ body: posts(['2', '1']) }))

    try {
      await ttags(['--blog', 'b'], dir, { TTAGS_API_BASE: server.url })
      const before = server.requests.length
      const second = await ttags(['--blog', 'b'], dir, { TTAGS_API_BASE: server.url })

      expect(second.code).toBe(0)
      expect(server.requests.length - before).toBe(1)
    } finally {
      await server.close()
    }
  })

  it('survives the empty response that used to crash 1.x', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer((_url, index) =>
      index === 0 ? { raw: '' } : { body: posts(['1']) },
    )

    try {
      const result = await ttags(['--blog', 'b', '--retries', '3'], dir, {
        TTAGS_API_BASE: server.url,
      })

      expect(result.code).toBe(0)
      expect(server.requests.length).toBe(2)
    } finally {
      await server.close()
    }
  })

  it('exits 3 on a rate limit, keeping what it collected', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer((_url, index) =>
      index === 0
        ? { body: posts(['9'], 100) }
        : {
            status: 429,
            headers: { 'x-ratelimit-perhour-reset': '3000' },
            body: { meta: { status: 429, msg: 'Limit Exceeded' } },
          },
    )

    try {
      const result = await ttags(['--blog', 'b', '--page-size', '1'], dir, {
        TTAGS_API_BASE: server.url,
      })

      expect(result.code).toBe(3)

      const snapshot = JSON.parse(await readFile(join(dir, 'tmp/source.json'), 'utf8'))

      expect(snapshot.posts).toHaveLength(1)
    } finally {
      await server.close()
    }
  })

  it('exits 4 on a rejected key', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer(() => ({
      status: 401,
      body: { meta: { status: 401, msg: 'Not Authorized' } },
    }))

    try {
      expect((await ttags(['--blog', 'b'], dir, { TTAGS_API_BASE: server.url })).code).toBe(4)
    } finally {
      await server.close()
    }
  })

  it('exits 5 on a missing blog', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer(() => ({
      status: 404,
      body: { meta: { status: 404, msg: 'Not Found' } },
    }))

    try {
      expect((await ttags(['--blog', 'nope'], dir, { TTAGS_API_BASE: server.url })).code).toBe(5)
    } finally {
      await server.close()
    }
  })

  it('reads the config from the current directory', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer(() => ({ body: posts(['1']) }))

    try {
      await writeFile(
        join(dir, 'ttags.config.json'),
        JSON.stringify({ blog: 'blog-from-config', out: 'out/tags.json' }),
        'utf8',
      )

      const result = await ttags([], dir, { TTAGS_API_BASE: server.url })

      expect(result.code).toBe(0)
      expect(server.requests[0]).toContain('/blog/blog-from-config/posts')
      expect(JSON.parse(await readFile(join(dir, 'out/tags.json'), 'utf8'))).toHaveLength(2)
    } finally {
      await server.close()
    }
  })

  it('rejects a 1.x cache and says what to do', async () => {
    const dir = await tempDir()

    await writeFile(join(dir, 'ttags.config.json'), '{"blog":"b","snapshot":"old.json"}', 'utf8')
    await writeFile(join(dir, 'old.json'), '{"tags":{"cat":0},"posts":{"1":[0]}}', 'utf8')

    const result = await ttags([], dir)

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('1.x')
  })

  it('writes nothing on a dry run', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer(() => ({ body: posts(['1']) }))

    try {
      const result = await ttags(['--blog', 'b', '--dry-run'], dir, { TTAGS_API_BASE: server.url })

      expect(result.code).toBe(0)
      await expect(readFile(join(dir, 'tmp/source.json'), 'utf8')).rejects.toThrow()
    } finally {
      await server.close()
    }
  })

  it('re-reads the named posts', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer(url => ({
      body: posts([url.searchParams.get('id') ?? '1']),
    }))

    try {
      const result = await ttags(['post', '139236866355'], dir, { TTAGS_API_BASE: server.url })

      expect(result.code).toBe(2)

      await writeFile(join(dir, 'ttags.config.json'), '{"blog":"b"}', 'utf8')

      const second = await ttags(['post', '139236866355'], dir, { TTAGS_API_BASE: server.url })

      expect(second.code).toBe(0)
      expect(server.requests.at(-1)).toContain('id=139236866355')
    } finally {
      await server.close()
    }
  })

  it('rebuilds tags from the snapshot without touching the network', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer(() => ({ body: posts(['2', '1']) }))

    try {
      await ttags(['--blog', 'b'], dir, { TTAGS_API_BASE: server.url })
      const before = server.requests.length

      const result = await ttags(['tags', '--blog', 'b', '--min-count', '2'], dir, {
        TTAGS_API_BASE: server.url,
      })

      expect(result.code).toBe(0)
      expect(server.requests.length).toBe(before)
      expect(JSON.parse(await readFile(join(dir, 'dist/tags.json'), 'utf8'))).toEqual([
        { tag: 'cat', count: 2 },
      ])
    } finally {
      await server.close()
    }
  })

  it('an interrupted run exits 3 and keeps what it collected', async () => {
    const dir = await tempDir()
    // Every page must bring a new post, or the crawl finishes on its own as
    // up-to-date and exits 0 before the signal decides anything.
    const server = await startFixtureServer((_url, index) => ({
      body: posts([String(1000 - index)], 1000),
    }))

    try {
      const child = spawn(process.execPath, [CLI, '--blog', 'b', '--page-size', '1'], {
        cwd: dir,
        env: { ...process.env, TUMBLR_CONSUMER_KEY: 'k', TTAGS_API_BASE: server.url },
      })

      const code = await new Promise<number>(resolve => {
        // Signal from the second request on: by then the first page is on disk,
        // because the checkpoint is awaited before the next request goes out.
        // Repeating the signal keeps a slow runner from racing past it.
        server.onRequest = () => {
          if (server.requests.length >= 2) {
            child.kill('SIGTERM')
          }
        }

        child.on('exit', value => resolve(value ?? -1))
      })

      expect(code).toBe(3)
      expect(
        JSON.parse(await readFile(join(dir, 'tmp/source.json'), 'utf8')).posts.length,
      ).toBeGreaterThan(0)
    } finally {
      await server.close()
    }
  })

  it('never prints the access key, in any mode', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer(() => ({
      status: 500,
      body: { meta: { status: 500 } },
    }))

    try {
      const result = await ttags(['--blog', 'b', '--retries', '1', '--verbose'], dir, {
        TTAGS_API_BASE: server.url,
        TUMBLR_CONSUMER_KEY: 'very-secret-key',
      })

      expect(`${result.stdout}${result.stderr}`).not.toContain('very-secret-key')
    } finally {
      await server.close()
    }
  })
})
