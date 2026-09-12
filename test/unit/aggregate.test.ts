import { describe, expect, it } from 'vitest'
import { countTags } from '../../src/aggregate.js'
import { removePosts } from '../../src/snapshot/ops.js'
import { emptySnapshot, mergePosts } from '../../src/snapshot/schema.js'

const snapshot = () =>
  mergePosts(emptySnapshot('blog'), [
    { id: '3', timestamp: 30, tags: ['кот', 'капот'] },
    { id: '2', timestamp: 20, tags: ['кот'] },
    { id: '1', timestamp: 10, tags: ['панда'] },
  ]).snapshot

describe('countTags', () => {
  it('считает посты на тег и сортирует по имени', () => {
    expect(countTags(snapshot())).toEqual([
      { tag: 'капот', count: 1 },
      { tag: 'кот', count: 2 },
      { tag: 'панда', count: 1 },
    ])
  })

  it('сортирует по убыванию количества, имя — при равенстве', () => {
    expect(countTags(snapshot(), { sort: 'count' })).toEqual([
      { tag: 'кот', count: 2 },
      { tag: 'капот', count: 1 },
      { tag: 'панда', count: 1 },
    ])
  })

  it('отбрасывает редкие теги', () => {
    expect(countTags(snapshot(), { minCount: 2 })).toEqual([{ tag: 'кот', count: 2 }])
  })

  it('считает пост один раз, даже если тег повторён — в 1.x выходило два', () => {
    const withDuplicate = mergePosts(emptySnapshot('blog'), [
      { id: '1', timestamp: 10, tags: ['кот', 'кот'] },
    ]).snapshot

    expect(countTags(withDuplicate)).toEqual([{ tag: 'кот', count: 1 }])
  })

  it('показывает нулём тег, оставшийся без постов', () => {
    const orphaned = removePosts(snapshot(), ['1'])

    expect(countTags(orphaned, { minCount: 0 })).toContainEqual({ tag: 'панда', count: 0 })
    expect(countTags(orphaned)).not.toContainEqual({ tag: 'панда', count: 0 })
  })

  it('на пустом снапшоте отдаёт пустой список', () => {
    expect(countTags(emptySnapshot('blog'))).toEqual([])
  })
})
