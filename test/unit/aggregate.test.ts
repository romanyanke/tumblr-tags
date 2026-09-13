import { describe, expect, it } from 'vitest'
import { countTags } from '../../src/aggregate.js'
import { removePosts } from '../../src/snapshot/ops.js'
import { emptySnapshot, mergePosts } from '../../src/snapshot/schema.js'

// Tag names are deliberately non-ASCII: sorting goes through localeCompare.
const snapshot = () =>
  mergePosts(emptySnapshot('blog'), [
    { id: '3', timestamp: 30, tags: ['éclair', 'ähre'] },
    { id: '2', timestamp: 20, tags: ['éclair'] },
    { id: '1', timestamp: 10, tags: ['zèbre'] },
  ]).snapshot

describe('countTags', () => {
  it('counts posts per tag and sorts by name', () => {
    expect(countTags(snapshot())).toEqual([
      { tag: 'ähre', count: 1 },
      { tag: 'éclair', count: 2 },
      { tag: 'zèbre', count: 1 },
    ])
  })

  it('sorts by descending count, breaking ties by name', () => {
    expect(countTags(snapshot(), { sort: 'count' })).toEqual([
      { tag: 'éclair', count: 2 },
      { tag: 'ähre', count: 1 },
      { tag: 'zèbre', count: 1 },
    ])
  })

  it('drops rare tags', () => {
    expect(countTags(snapshot(), { minCount: 2 })).toEqual([{ tag: 'éclair', count: 2 }])
  })

  it('counts a post once even when it repeats a tag — 1.x counted two', () => {
    const withDuplicate = mergePosts(emptySnapshot('blog'), [
      { id: '1', timestamp: 10, tags: ['éclair', 'éclair'] },
    ]).snapshot

    expect(countTags(withDuplicate)).toEqual([{ tag: 'éclair', count: 1 }])
  })

  it('reports a tag left without posts as zero', () => {
    const orphaned = removePosts(snapshot(), ['1'])

    expect(countTags(orphaned, { minCount: 0 })).toContainEqual({ tag: 'zèbre', count: 0 })
    expect(countTags(orphaned)).not.toContainEqual({ tag: 'zèbre', count: 0 })
  })

  it('returns an empty list for an empty snapshot', () => {
    expect(countTags(emptySnapshot('blog'))).toEqual([])
  })
})
