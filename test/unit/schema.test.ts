import { describe, expect, it } from 'vitest'
import { SnapshotSchemaError } from '../../src/errors.js'
import {
  emptySnapshot,
  mergePosts,
  parseSnapshot,
  serializeSnapshot,
} from '../../src/snapshot/schema.js'

describe('parseSnapshot', () => {
  it('читает снапшот текущей схемы', () => {
    const snapshot = mergePosts(emptySnapshot('blog'), [
      { id: '1', timestamp: 10, tags: ['a', 'b'] },
    ]).snapshot

    expect(parseSnapshot(serializeSnapshot(snapshot))).toEqual(snapshot)
  })

  it('отвергает кеш 1.x и объясняет, что делать', () => {
    const legacy = JSON.stringify({ tags: { a: 0 }, posts: { '1': [0] } })

    expect(() => parseSnapshot(legacy)).toThrow(SnapshotSchemaError)
    expect(() => parseSnapshot(legacy)).toThrow(/1\.x/)
    expect(() => parseSnapshot(legacy)).toThrow(/удалите файл/i)
  })

  it('отвергает неизвестную версию схемы', () => {
    expect(() => parseSnapshot(JSON.stringify({ schema: 99 }))).toThrow(/Неизвестная версия/)
  })

  it('отвергает мусор вместо объекта', () => {
    expect(() => parseSnapshot('"строка"')).toThrow(SnapshotSchemaError)
    expect(() => parseSnapshot(JSON.stringify({ schema: 2, blog: 'b' }))).toThrow(
      SnapshotSchemaError,
    )
  })

  it('подставляет ноль вместо отсутствующего времени поста', () => {
    const raw = JSON.stringify({
      schema: 2,
      blog: 'b',
      generatedAt: '2026-01-01T00:00:00.000Z',
      totalPosts: 1,
      tags: ['a'],
      posts: [{ id: '1', tags: [0] }],
    })

    expect(parseSnapshot(raw).posts[0]?.timestamp).toBe(0)
  })
})

describe('mergePosts', () => {
  it('добавляет новые посты и заводит теги', () => {
    const { snapshot, added, updated } = mergePosts(emptySnapshot('b'), [
      { id: '2', timestamp: 20, tags: ['кот', 'капот'] },
      { id: '1', timestamp: 10, tags: ['кот'] },
    ])

    expect(added).toBe(2)
    expect(updated).toBe(0)
    expect(snapshot.tags).toEqual(['кот', 'капот'])
    expect(snapshot.posts).toEqual([
      { id: '2', timestamp: 20, tags: [0, 1] },
      { id: '1', timestamp: 10, tags: [0] },
    ])
  })

  it('обновляет известный пост на месте, не сдвигая порядок', () => {
    const first = mergePosts(emptySnapshot('b'), [
      { id: '2', timestamp: 20, tags: ['a'] },
      { id: '1', timestamp: 10, tags: ['b'] },
    ]).snapshot

    const { snapshot, added, updated } = mergePosts(first, [
      { id: '2', timestamp: 20, tags: ['c'] },
    ])

    expect({ added, updated }).toEqual({ added: 0, updated: 1 })
    expect(snapshot.posts.map(post => post.id)).toEqual(['2', '1'])
    expect(snapshot.posts[0]?.tags).toEqual([2])
  })

  it('отсеивает повторы тега внутри поста', () => {
    const { snapshot } = mergePosts(emptySnapshot('b'), [
      { id: '1', timestamp: 10, tags: ['кот', 'кот', 'пёс'] },
    ])

    expect(snapshot.posts[0]?.tags).toEqual([0, 1])
    expect(snapshot.tags).toEqual(['кот', 'пёс'])
  })

  it('не сдвигает идентификаторы уже известных тегов', () => {
    const first = mergePosts(emptySnapshot('b'), [
      { id: '1', timestamp: 1, tags: ['a', 'b'] },
    ]).snapshot
    const { snapshot } = mergePosts(first, [{ id: '2', timestamp: 2, tags: ['b', 'c'] }])

    expect(snapshot.tags).toEqual(['a', 'b', 'c'])
    expect(snapshot.posts[1]?.tags).toEqual([1, 2])
  })

  it('не создаёт новый снапшот на пустом списке', () => {
    const snapshot = emptySnapshot('b')

    expect(mergePosts(snapshot, []).snapshot).toBe(snapshot)
  })

  it('сохраняет длинные идентификаторы без потери точности', () => {
    const id = '781234567890123456'
    const { snapshot } = mergePosts(emptySnapshot('b'), [{ id, timestamp: 1, tags: [] }])

    expect(snapshot.posts[0]?.id).toBe(id)
  })
})
