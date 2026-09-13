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
    { id: '3', timestamp: 30, tags: ['éclair', 'ähre'] },
    { id: '2', timestamp: 20, tags: ['éclair'] },
    { id: '1', timestamp: 10, tags: ['zèbre'] },
  ]).snapshot

describe('snapshot lookups', () => {
  it('returns a tag name and a tag id', () => {
    const snapshot = sample()

    expect(tagName(snapshot, 0)).toBe('éclair')
    expect(tagName(snapshot, 99)).toBeUndefined()
    expect(tagId(snapshot, 'ähre')).toBe(1)
    expect(tagId(snapshot, 'no such tag')).toBeUndefined()
    expect(tagIndex(snapshot).get('zèbre')).toBe(2)
  })

  it("returns a post's tags by name, in the post's own order", () => {
    expect(postTags(sample(), '3')).toEqual(['éclair', 'ähre'])
    expect(postTags(sample(), 'missing')).toBeUndefined()
  })

  it('returns posts carrying a tag, newest first', () => {
    expect(postsByTag(sample(), 'éclair')).toEqual(['3', '2'])
    expect(postsByTag(sample(), 0)).toEqual(['3', '2'])
    expect(postsByTag(sample(), 'no such tag')).toEqual([])
  })

  it('finds a post by id', () => {
    expect(findPost(sample(), '2')?.timestamp).toBe(20)
    expect(findPost(sample(), 'missing')).toBeUndefined()
  })
})

describe('compactTags', () => {
  it('drops tags without posts and renumbers the rest', () => {
    const withDead = removePosts(sample(), ['3'])

    expect(unusedTags(withDead)).toEqual(['ähre'])

    const compact = compactTags(withDead)

    expect(compact.tags).toEqual(['éclair', 'zèbre'])
    expect(unusedTags(compact)).toEqual([])
    expect(postTags(compact, '1')).toEqual(['zèbre'])
    expect(postTags(compact, '2')).toEqual(['éclair'])
  })

  it('changes nothing when no tag is dead', () => {
    const snapshot = sample()

    expect(compactTags(snapshot).tags).toEqual(snapshot.tags)
  })
})

describe('changing a snapshot', () => {
  it('upsertPost adds and replaces', () => {
    const added = upsertPost(sample(), { id: '4', timestamp: 40, tags: ['new'] })

    expect(added.posts).toHaveLength(4)
    expect(postTags(added, '4')).toEqual(['new'])

    const replaced = upsertPost(added, { id: '4', timestamp: 40, tags: ['éclair'] })

    expect(replaced.posts).toHaveLength(4)
    expect(postTags(replaced, '4')).toEqual(['éclair'])
  })

  it('removePosts leaves the tag dictionary alone', () => {
    const result = removePosts(sample(), ['1'])

    expect(result.posts.map(post => post.id)).toEqual(['3', '2'])
    expect(result.tags).toEqual(['éclair', 'ähre', 'zèbre'])
  })

  it('removePosts returns the same snapshot for an empty list', () => {
    const snapshot = sample()

    expect(removePosts(snapshot, [])).toBe(snapshot)
  })
})
