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
    ids.map(id => ({ id, timestamp: Number(id), tags: ['кот', `тег-${id}`] })),
    total,
  )

describe('resolveSettings', () => {
  it('флаг перекрывает конфиг', async () => {
    const dir = await tempDir()

    await writeFile(join(dir, 'ttags.config.json'), '{"blog":"из-конфига"}', 'utf8')

    const settings = await resolveSettings(parseCliArgs(['--blog', 'из-флага']), context(dir), {
      requireKey: true,
    })

    expect(settings.blog).toBe('из-флага')
  })

  it('пути по умолчанию считаются от текущего каталога', async () => {
    const dir = await tempDir()
    const settings = await resolveSettings(parseCliArgs(['--blog', 'b']), context(dir), {
      requireKey: false,
    })

    expect(settings.snapshotPath).toBe(join(dir, 'tmp/source.json'))
    expect(settings.outPath).toBe(join(dir, 'dist/tags.json'))
  })

  it('без блога и без ключа — понятные ошибки', async () => {
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
    ).rejects.toThrow(/ключ/)
  })

  it('команде tags ключ не нужен', async () => {
    const dir = await tempDir()
    const settings = await resolveSettings(
      parseCliArgs(['tags', '--blog', 'b']),
      { logger: silent(), cwd: dir, env: {} },
      { requireKey: false },
    )

    expect(settings.consumerKey).toBe('')
  })
})

describe('runSync', () => {
  it('собирает блог и пишет оба файла', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer(() => ({ body: posts(['2', '1']) }))

    try {
      const code = await runSync(parseCliArgs(['--blog', 'b']), context(dir, server.url))

      expect(code).toBe(EXIT.ok)
      expect(JSON.parse(await readFile(join(dir, 'tmp/source.json'), 'utf8')).posts).toHaveLength(2)
      expect(JSON.parse(await readFile(join(dir, 'dist/tags.json'), 'utf8'))).toContainEqual({
        tag: 'кот',
        count: 2,
      })
    } finally {
      await server.close()
    }
  })

  it('с --no-tags не трогает файл тегов', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer(() => ({ body: posts(['1']) }))

    try {
      await runSync(parseCliArgs(['--blog', 'b', '--no-tags']), context(dir, server.url))

      await expect(readFile(join(dir, 'dist/tags.json'), 'utf8')).rejects.toThrow()
    } finally {
      await server.close()
    }
  })

  it('с --min-count отбрасывает редкие теги', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer(() => ({ body: posts(['2', '1']) }))

    try {
      await runSync(parseCliArgs(['--blog', 'b', '--min-count', '2']), context(dir, server.url))

      expect(JSON.parse(await readFile(join(dir, 'dist/tags.json'), 'utf8'))).toEqual([
        { tag: 'кот', count: 2 },
      ])
    } finally {
      await server.close()
    }
  })

  it('с --compact выбрасывает теги, оставшиеся без постов', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer((_url, index) =>
      index === 0 ? { body: posts(['1'], 1) } : { body: posts(['1'], 1) },
    )

    try {
      await runSync(parseCliArgs(['--blog', 'b']), context(dir, server.url))

      // Пост тот же, но с другими тегами: старые остаются в словаре мёртвыми.
      const changed = await startFixtureServer(() => ({
        body: postsResponse([{ id: '1', timestamp: 1, tags: ['другой'] }], 1),
      }))

      try {
        await runSync(
          parseCliArgs(['--blog', 'b', '--full', '--compact']),
          context(dir, changed.url),
        )

        const snapshot = JSON.parse(await readFile(join(dir, 'tmp/source.json'), 'utf8'))

        expect(snapshot.tags).toEqual(['другой'])
      } finally {
        await changed.close()
      }
    } finally {
      await server.close()
    }
  })

  it('на исчерпанном бюджете отдаёт код 3, сохранив снапшот', async () => {
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

describe('runPost', () => {
  it('перечитывает названный пост', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer(url => ({
      body: postsResponse(
        [{ id: url.searchParams.get('id') ?? '0', timestamp: 5, tags: ['свежий'] }],
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
        'свежий',
      ])
    } finally {
      await server.close()
    }
  })

  it('пропавший пост даёт код 3, а не падение', async () => {
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
  it('пересобирает теги из снапшота без сети', async () => {
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

  it('без снапшота объясняет, что запустить', async () => {
    const dir = await tempDir()

    await expect(runTags(parseCliArgs(['tags', '--blog', 'b']), context(dir))).rejects.toThrow(
      /Запустите ttags/,
    )
  })

  it('сухой прогон ничего не пишет', async () => {
    const dir = await tempDir()
    const server = await startFixtureServer(() => ({ body: posts(['1']) }))

    try {
      await runSync(parseCliArgs(['--blog', 'b']), context(dir, server.url))
      await runTags(
        parseCliArgs(['tags', '--blog', 'b', '--out', 'нет.json', '--dry-run']),
        context(dir, server.url),
      )

      await expect(readFile(join(dir, 'нет.json'), 'utf8')).rejects.toThrow()
    } finally {
      await server.close()
    }
  })
})
