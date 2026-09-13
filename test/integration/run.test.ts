import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCliArgs } from '../../src/cli-args.js'
import { createLogger } from '../../src/logger.js'
import { EXIT, resolveSettings, runPost, runSync, runTags, SettingsError } from '../../src/run.js'
import { startFixtureServer } from '../helpers/fixture-server.js'
import { postsResponse } from '../helpers/mock-fetch.js'
import { tempDir } from '../helpers/tmp-dir.js'

const silent = () => createLogger({ level: 'quiet' })

const context = (cwd: string, url?: string) => ({
  logger: silent(),
  cwd,
  env: {
    TUMBLR_CONSUMER_KEY: 'key',
    ...(url ? { TTAGS_API_BASE: url } : {}),
  } as NodeJS.ProcessEnv,
})

const posts = (ids: string[], total = ids.length) =>
  postsResponse(
    ids.map(id => ({ id, timestamp: Number(id), tags: ['cat', `tag-${id}`] })),
    total,
  )

describe('resolveSettings', () => {
  it('a flag overrides the config', async () => {
    const dir = await tempDir()

    await writeFile(join(dir, 'ttags.config.json'), '{"blog":"from-config"}', 'utf8')

    const settings = await resolveSettings(parseCliArgs(['--blog', 'from-flag']), context(dir), {
      requireKey: true,
    })

    expect(settings.blog).toBe('from-flag')
  })

  it('default paths resolve against the current directory', async () => {
    const dir = await tempDir()
    const settings = await resolveSettings(parseCliArgs(['--blog', 'b']), context(dir), {
      requireKey: false,
    })

    expect(settings.snapshotPath).toBe(join(dir, 'tmp/source.json'))
    expect(settings.outPath).toBe(join(dir, 'dist/tags.json'))
  })

  it('reports clear errors without a blog and without a key', async () => {
    const dir = await tempDir()

    await expect(
      resolveSettings(parseCliArgs([]), context(dir), { requireKey: false }),
    ).rejects.toThrow(SettingsError)

    await expect(
      resolveSettings(
        parseCliArgs(['--blog', 'b']),
        { logger: silent(), cwd: dir, env: {} },
        {
          requireKey: true,
        },
      ),
    ).rejects.toThrow(/access key/)
  })

  it('the tags command needs no key', async () => {
    const dir = await tempDir()
    const settings = await resolveSettings(
      parseCliArgs(['tags', '--blog', 'b']),
      { logger: silent(), cwd: dir, env: {} },
      { requireKey: false },
    )

    expect(settings.consumerKey).toBe('')
  })
})

describe('settings from the config', () => {
  it('maxRequests and pageSize from the config reach the crawl', async () => {
    const dir = await tempDir()

    await writeFile(
      join(dir, 'ttags.config.json'),
      '{"blog":"b","maxRequests":2,"pageSize":50}',
      'utf8',
    )

    const settings = await resolveSettings(parseCliArgs([]), context(dir), { requireKey: true })

    expect(settings).toMatchObject({ maxRequests: 2, pageSize: 50 })
  })

  it('a flag overrides the config here as well', async () => {
    const dir = await tempDir()

    await writeFile(join(dir, 'ttags.config.json'), '{"blog":"b","pageSize":50}', 'utf8')

    const settings = await resolveSettings(parseCliArgs(['--page-size', '20']), context(dir), {
      requireKey: true,
    })

    expect(settings.pageSize).toBe(20)
  })

  it('leaves the collect layer defaults when unset', async () => {
    const dir = await tempDir()
    const settings = await resolveSettings(parseCliArgs(['--blog', 'b']), context(dir), {
      requireKey: true,
    })

    expect(settings.maxRequests).toBeUndefined()
    expect(settings.pageSize).toBeUndefined()
  })

  it('a budget from the config really limits the run', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer((_url, index) => ({
      body: posts([String(100 - index)], 100),
    }))

    try {
      await writeFile(
        join(dir, 'ttags.config.json'),
        '{"blog":"b","maxRequests":2,"pageSize":1}',
        'utf8',
      )

      const code = await runSync(parseCliArgs([]), context(dir, server.url))

      expect(server.requests).toHaveLength(2)
      expect(code).toBe(EXIT.incomplete)
    } finally {
      await server.close()
    }
  })
})

describe('runSync', () => {
  it('collects the blog and writes both files', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer(() => ({ body: posts(['2', '1']) }))

    try {
      const code = await runSync(parseCliArgs(['--blog', 'b']), context(dir, server.url))

      expect(code).toBe(EXIT.ok)
      expect(JSON.parse(await readFile(join(dir, 'tmp/source.json'), 'utf8')).posts).toHaveLength(2)
      expect(JSON.parse(await readFile(join(dir, 'dist/tags.json'), 'utf8'))).toContainEqual({
        tag: 'cat',
        count: 2,
      })
    } finally {
      await server.close()
    }
  })

  it('with --no-tags it leaves the tag file alone', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer(() => ({ body: posts(['1']) }))

    try {
      await runSync(parseCliArgs(['--blog', 'b', '--no-tags']), context(dir, server.url))

      await expect(readFile(join(dir, 'dist/tags.json'), 'utf8')).rejects.toThrow()
    } finally {
      await server.close()
    }
  })

  it('with --min-count it drops rare tags', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer(() => ({ body: posts(['2', '1']) }))

    try {
      await runSync(parseCliArgs(['--blog', 'b', '--min-count', '2']), context(dir, server.url))

      expect(JSON.parse(await readFile(join(dir, 'dist/tags.json'), 'utf8'))).toEqual([
        { tag: 'cat', count: 2 },
      ])
    } finally {
      await server.close()
    }
  })

  it('with --compact it drops tags left without posts', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer((_url, index) =>
      index === 0 ? { body: posts(['1'], 1) } : { body: posts(['1'], 1) },
    )

    try {
      await runSync(parseCliArgs(['--blog', 'b']), context(dir, server.url))

      // Same post, different tags: the old ones stay in the dictionary, dead.
      const changed = await startFixtureServer(() => ({
        body: postsResponse([{ id: '1', timestamp: 1, tags: ['other'] }], 1),
      }))

      try {
        await runSync(
          parseCliArgs(['--blog', 'b', '--full', '--compact']),
          context(dir, changed.url),
        )

        const snapshot = JSON.parse(await readFile(join(dir, 'tmp/source.json'), 'utf8'))

        expect(snapshot.tags).toEqual(['other'])
      } finally {
        await changed.close()
      }
    } finally {
      await server.close()
    }
  })

  it('returns exit code 3 on a spent budget, snapshot saved', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer((_url, index) => ({
      body: posts([String(100 - index)], 100),
    }))

    try {
      const code = await runSync(
        parseCliArgs(['--blog', 'b', '--page-size', '1', '--max-requests', '2']),
        context(dir, server.url),
      )

      expect(code).toBe(EXIT.incomplete)
      expect(JSON.parse(await readFile(join(dir, 'tmp/source.json'), 'utf8')).posts).toHaveLength(2)
    } finally {
      await server.close()
    }
  })
})

describe('an interrupted run', () => {
  it('gives exit code 3, not 0: a CI wrapper must not call it a success', async () => {
    const dir = await tempDir()
    const controller = new AbortController()
    const server = await startFixtureServer((_url, index) => {
      // The first page reaches disk; the interrupt arrives on the second request.
      if (index === 1) {
        controller.abort(new Error('SIGTERM'))
      }

      return { body: posts([String(100 - index)], 100) }
    })

    try {
      const code = await runSync(parseCliArgs(['--blog', 'b', '--page-size', '1']), {
        ...context(dir, server.url),
        signal: controller.signal,
      })

      expect(code).toBe(EXIT.incomplete)
      expect(JSON.parse(await readFile(join(dir, 'tmp/source.json'), 'utf8')).posts).toHaveLength(1)
    } finally {
      await server.close()
    }
  })
})

describe('runPost', () => {
  it('re-reads a named post', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer(url => ({
      body: postsResponse(
        [{ id: url.searchParams.get('id') ?? '0', timestamp: 5, tags: ['fresh'] }],
        10,
      ),
    }))

    try {
      const code = await runPost(
        parseCliArgs(['post', '42', '--blog', 'b']),
        context(dir, server.url),
      )

      expect(code).toBe(EXIT.ok)
      expect(JSON.parse(await readFile(join(dir, 'tmp/source.json'), 'utf8')).tags).toEqual([
        'fresh',
      ])
    } finally {
      await server.close()
    }
  })

  it('a missing post yields exit code 3 rather than a crash', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer(() => ({
      status: 404,
      body: { meta: { status: 404, msg: 'Not Found' } },
    }))

    try {
      const code = await runPost(
        parseCliArgs(['post', '42', '--blog', 'b']),
        context(dir, server.url),
      )

      expect(code).toBe(EXIT.incomplete)
    } finally {
      await server.close()
    }
  })
})

describe('runTags', () => {
  it('rebuilds tags from the snapshot without the network', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer(() => ({ body: posts(['2', '1']) }))

    try {
      await runSync(parseCliArgs(['--blog', 'b']), context(dir, server.url))
      const before = server.requests.length

      const code = await runTags(
        parseCliArgs(['tags', '--blog', 'b', '--out', 'other.json']),
        context(dir, server.url),
      )

      expect(code).toBe(EXIT.ok)
      expect(server.requests.length).toBe(before)
      expect(JSON.parse(await readFile(join(dir, 'other.json'), 'utf8'))).toHaveLength(3)
    } finally {
      await server.close()
    }
  })

  it('explains what to run when there is no snapshot', async () => {
    const dir = await tempDir()

    await expect(runTags(parseCliArgs(['tags', '--blog', 'b']), context(dir))).rejects.toThrow(
      /Run ttags first/,
    )
  })

  it('a dry run writes nothing', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer(() => ({ body: posts(['1']) }))

    try {
      await runSync(parseCliArgs(['--blog', 'b']), context(dir, server.url))
      await runTags(
        parseCliArgs(['tags', '--blog', 'b', '--out', 'skipped.json', '--dry-run']),
        context(dir, server.url),
      )

      await expect(readFile(join(dir, 'skipped.json'), 'utf8')).rejects.toThrow()
    } finally {
      await server.close()
    }
  })
})
