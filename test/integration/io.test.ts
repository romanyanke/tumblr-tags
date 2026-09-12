import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SnapshotSchemaError } from '../../src/errors.js'
import {
  readSnapshot,
  readSnapshotIfExists,
  writeSnapshot,
  writeTagCounts,
} from '../../src/snapshot/io.js'
import { emptySnapshot, mergePosts } from '../../src/snapshot/schema.js'
import { tempDir } from '../helpers/tmp-dir.js'

const sample = () =>
  mergePosts(emptySnapshot('blog'), [{ id: '1', timestamp: 10, tags: ['кот'] }]).snapshot

describe('чтение и запись снапшота', () => {
  it('переживает круг запись-чтение', async () => {
    const path = join(await tempDir(), 'source.json')

    await writeSnapshot(path, sample())

    expect(await readSnapshot(path)).toEqual(sample())
  })

  it('создаёт вложенные каталоги — в 1.x тут был ENOENT', async () => {
    const path = join(await tempDir(), 'build', 'cache', 'source.json')

    await writeSnapshot(path, sample())

    expect((await readSnapshot(path)).posts).toHaveLength(1)
  })

  it('отсутствие файла — не ошибка', async () => {
    expect(await readSnapshotIfExists(join(await tempDir(), 'нет.json'))).toBeNull()
  })

  it('повреждённый файл — ошибка, а не тихий пустой снапшот', async () => {
    const path = join(await tempDir(), 'source.json')

    await writeFile(path, '{ не json', 'utf8')

    await expect(readSnapshotIfExists(path)).rejects.toThrow()
  })

  it('кеш 1.x отвергается с понятным сообщением', async () => {
    const path = join(await tempDir(), 'source.json')

    await writeFile(path, JSON.stringify({ tags: { кот: 0 }, posts: { '1': [0] } }), 'utf8')

    await expect(readSnapshotIfExists(path)).rejects.toThrow(SnapshotSchemaError)
  })

  it('не оставляет временных файлов рядом', async () => {
    const dir = await tempDir()
    const path = join(dir, 'source.json')

    await writeSnapshot(path, sample())

    const { readdir } = await import('node:fs/promises')

    expect(await readdir(dir)).toEqual(['source.json'])
  })

  it('перезапись не рвёт файл: старое содержимое сменяется целым новым', async () => {
    const path = join(await tempDir(), 'source.json')

    await writeSnapshot(path, sample())
    await writeSnapshot(
      path,
      mergePosts(sample(), [{ id: '2', timestamp: 20, tags: ['пёс'] }]).snapshot,
    )

    const parsed = await readSnapshot(path)

    expect(parsed.posts).toHaveLength(2)
    expect(JSON.parse(await readFile(path, 'utf8'))).toBeTruthy()
  })
})

describe('writeTagCounts', () => {
  it('пишет плоский список, который читают потребители', async () => {
    const path = join(await tempDir(), 'dist', 'tags.json')

    await writeTagCounts(path, [{ tag: 'кот', count: 2 }])

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual([{ tag: 'кот', count: 2 }])
  })
})
