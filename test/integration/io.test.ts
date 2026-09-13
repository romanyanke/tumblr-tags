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
  mergePosts(emptySnapshot('blog'), [{ id: '1', timestamp: 10, tags: ['cat'] }]).snapshot

describe('reading and writing a snapshot', () => {
  it('survives a write-read round trip', async () => {
    const path = join(await tempDir(), 'source.json')

    await writeSnapshot(path, sample())

    expect(await readSnapshot(path)).toEqual(sample())
  })

  it('creates nested directories — 1.x threw ENOENT here', async () => {
    const path = join(await tempDir(), 'build', 'cache', 'source.json')

    await writeSnapshot(path, sample())

    expect((await readSnapshot(path)).posts).toHaveLength(1)
  })

  it('treats a missing file as no error', async () => {
    expect(await readSnapshotIfExists(join(await tempDir(), 'missing.json'))).toBeNull()
  })

  it('treats a corrupt file as an error, not a silent empty snapshot', async () => {
    const path = join(await tempDir(), 'source.json')

    await writeFile(path, '{ not json', 'utf8')

    await expect(readSnapshotIfExists(path)).rejects.toThrow()
  })

  it('rejects a 1.x cache with a clear message', async () => {
    const path = join(await tempDir(), 'source.json')

    await writeFile(path, JSON.stringify({ tags: { cat: 0 }, posts: { '1': [0] } }), 'utf8')

    await expect(readSnapshotIfExists(path)).rejects.toThrow(SnapshotSchemaError)
  })

  it('leaves no temporary files behind', async () => {
    const dir = await tempDir()
    const path = join(dir, 'source.json')

    await writeSnapshot(path, sample())

    const { readdir } = await import('node:fs/promises')

    expect(await readdir(dir)).toEqual(['source.json'])
  })

  it('rewriting never tears the file: old content is replaced whole', async () => {
    const path = join(await tempDir(), 'source.json')

    await writeSnapshot(path, sample())
    await writeSnapshot(
      path,
      mergePosts(sample(), [{ id: '2', timestamp: 20, tags: ['dog'] }]).snapshot,
    )

    const parsed = await readSnapshot(path)

    expect(parsed.posts).toHaveLength(2)
    expect(JSON.parse(await readFile(path, 'utf8'))).toBeTruthy()
  })
})

describe('writeTagCounts', () => {
  it('writes the flat list consumers read', async () => {
    const path = join(await tempDir(), 'dist', 'tags.json')

    await writeTagCounts(path, [{ tag: 'cat', count: 2 }])

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual([{ tag: 'cat', count: 2 }])
  })
})
