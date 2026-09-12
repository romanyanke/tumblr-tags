import { describe, expect, it } from 'vitest'
import {
  compactTags,
  findPost,
  postsByTag,
  postTags,
  removePosts,
  tagId,
  tagIndex,
  tagName,
  unusedTags,
  upsertPost,
} from '../../src/snapshot/ops.js'
import { emptySnapshot, mergePosts } from '../../src/snapshot/schema.js'

const sample = () =>
  mergePosts(emptySnapshot('blog'), [
    { id: '3', timestamp: 30, tags: ['кот', 'капот'] },
    { id: '2', timestamp: 20, tags: ['кот'] },
    { id: '1', timestamp: 10, tags: ['панда'] },
  ]).snapshot

describe('поиск по снапшоту', () => {
  it('отдаёт имя и идентификатор тега', () => {
    const snapshot = sample()

    expect(tagName(snapshot, 0)).toBe('кот')
    expect(tagName(snapshot, 99)).toBeUndefined()
    expect(tagId(snapshot, 'капот')).toBe(1)
    expect(tagId(snapshot, 'нет такого')).toBeUndefined()
    expect(tagIndex(snapshot).get('панда')).toBe(2)
  })

  it('отдаёт теги поста именами, в порядке поста', () => {
    expect(postTags(sample(), '3')).toEqual(['кот', 'капот'])
    expect(postTags(sample(), 'нет')).toBeUndefined()
  })

  it('отдаёт посты по тегу — новые сверху', () => {
    expect(postsByTag(sample(), 'кот')).toEqual(['3', '2'])
    expect(postsByTag(sample(), 0)).toEqual(['3', '2'])
    expect(postsByTag(sample(), 'нет такого')).toEqual([])
  })

  it('находит пост по идентификатору', () => {
    expect(findPost(sample(), '2')?.timestamp).toBe(20)
    expect(findPost(sample(), 'нет')).toBeUndefined()
  })
})

describe('compactTags', () => {
  it('выбрасывает теги без постов и уплотняет номера', () => {
    const withDead = removePosts(sample(), ['3'])

    expect(unusedTags(withDead)).toEqual(['капот'])

    const compact = compactTags(withDead)

    expect(compact.tags).toEqual(['кот', 'панда'])
    expect(unusedTags(compact)).toEqual([])
    expect(postTags(compact, '1')).toEqual(['панда'])
    expect(postTags(compact, '2')).toEqual(['кот'])
  })

  it('ничего не меняет, когда мёртвых тегов нет', () => {
    const snapshot = sample()

    expect(compactTags(snapshot).tags).toEqual(snapshot.tags)
  })
})

describe('изменение снапшота', () => {
  it('upsertPost добавляет и заменяет', () => {
    const added = upsertPost(sample(), { id: '4', timestamp: 40, tags: ['новый'] })

    expect(added.posts).toHaveLength(4)
    expect(postTags(added, '4')).toEqual(['новый'])

    const replaced = upsertPost(added, { id: '4', timestamp: 40, tags: ['кот'] })

    expect(replaced.posts).toHaveLength(4)
    expect(postTags(replaced, '4')).toEqual(['кот'])
  })

  it('removePosts не трогает словарь тегов', () => {
    const result = removePosts(sample(), ['1'])

    expect(result.posts.map(post => post.id)).toEqual(['3', '2'])
    expect(result.tags).toEqual(['кот', 'капот', 'панда'])
  })

  it('removePosts возвращает тот же снапшот на пустом списке', () => {
    const snapshot = sample()

    expect(removePosts(snapshot, [])).toBe(snapshot)
  })
})
