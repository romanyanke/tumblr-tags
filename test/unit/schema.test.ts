import { describe, expect, it } from 'vitest'
import { SnapshotSchemaError } from '../../src/errors.js'
import {
  emptySnapshot,
  mergePosts,
  parseSnapshot,
  serializeSnapshot,
  sortPosts,
} from '../../src/snapshot/schema.js'

describe('parseSnapshot', () => {
  it('reads a snapshot of the current schema', () => {
    const snapshot = mergePosts(emptySnapshot('blog'), [
      { id: '1', timestamp: 10, tags: ['a', 'b'] },
    ]).snapshot

    expect(parseSnapshot(serializeSnapshot(snapshot))).toEqual(snapshot)
  })

  it('rejects a 1.x cache and says what to do', () => {
    const legacy = JSON.stringify({ tags: { a: 0 }, posts: { '1': [0] } })

    expect(() => parseSnapshot(legacy)).toThrow(SnapshotSchemaError)
    expect(() => parseSnapshot(legacy)).toThrow(/1\.x/)
    expect(() => parseSnapshot(legacy)).toThrow(/delete the file/i)
  })

  it('rejects an unknown schema version', () => {
    expect(() => parseSnapshot(JSON.stringify({ schema: 99 }))).toThrow(/Unknown snapshot version/)
  })

  it('rejects junk instead of an object', () => {
    expect(() => parseSnapshot('"a string"')).toThrow(SnapshotSchemaError)
    expect(() => parseSnapshot(JSON.stringify({ schema: 2, blog: 'b' }))).toThrow(
      SnapshotSchemaError,
    )
  })

  it('falls back to zero for a missing post timestamp', () => {
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
  it('adds new posts and registers their tags', () => {
    const { snapshot, added, updated } = mergePosts(emptySnapshot('b'), [
      { id: '2', timestamp: 20, tags: ['éclair', 'ähre'] },
      { id: '1', timestamp: 10, tags: ['éclair'] },
    ])

    expect(added).toBe(2)
    expect(updated).toBe(0)
    expect(snapshot.tags).toEqual(['éclair', 'ähre'])
    expect(snapshot.posts).toEqual([
      { id: '2', timestamp: 20, tags: [0, 1] },
      { id: '1', timestamp: 10, tags: [0] },
    ])
  })

  it('updates a known post in place without disturbing the order', () => {
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

  it('drops a tag repeated within one post', () => {
    const { snapshot } = mergePosts(emptySnapshot('b'), [
      { id: '1', timestamp: 10, tags: ['éclair', 'éclair', 'señor'] },
    ])

    expect(snapshot.posts[0]?.tags).toEqual([0, 1])
    expect(snapshot.tags).toEqual(['éclair', 'señor'])
  })

  it('never shifts the ids of tags it already knows', () => {
    const first = mergePosts(emptySnapshot('b'), [
      { id: '1', timestamp: 1, tags: ['a', 'b'] },
    ]).snapshot
    const { snapshot } = mergePosts(first, [{ id: '2', timestamp: 2, tags: ['b', 'c'] }])

    expect(snapshot.tags).toEqual(['a', 'b', 'c'])
    expect(snapshot.posts.find(post => post.id === '2')?.tags).toEqual([1, 2])
  })

  it('returns the same snapshot for an empty list', () => {
    const snapshot = emptySnapshot('b')

    expect(mergePosts(snapshot, []).snapshot).toBe(snapshot)
  })

  it('keeps long ids exact', () => {
    const id = '781234567890123456'
    const { snapshot } = mergePosts(emptySnapshot('b'), [{ id, timestamp: 1, tags: [] }])

    expect(snapshot.posts[0]?.id).toBe(id)
  })
})

describe('newest-first order', () => {
  const crawl = () =>
    mergePosts(emptySnapshot('b'), [
      { id: '300', timestamp: 300, tags: ['c'] },
      { id: '200', timestamp: 200, tags: ['b'] },
      { id: '100', timestamp: 100, tags: ['a'] },
    ]).snapshot

  it('an incremental run puts a fresh post on top, not at the end', () => {
    const updated = mergePosts(crawl(), [{ id: '400', timestamp: 400, tags: ['d'] }]).snapshot

    expect(updated.posts.map(post => post.id)).toEqual(['400', '300', '200', '100'])
  })

  it('a post from the middle of the feed lands in its place', () => {
    const updated = mergePosts(crawl(), [{ id: '250', timestamp: 250, tags: ['e'] }]).snapshot

    expect(updated.posts.map(post => post.id)).toEqual(['300', '250', '200', '100'])
  })

  it('a whole page merges into a single ordered list', () => {
    const updated = mergePosts(crawl(), [
      { id: '500', timestamp: 500, tags: [] },
      { id: '250', timestamp: 250, tags: [] },
      { id: '50', timestamp: 50, tags: [] },
    ]).snapshot

    expect(updated.posts.map(post => post.id)).toEqual(['500', '300', '250', '200', '100', '50'])
  })

  it('updating a post does not move it', () => {
    const updated = mergePosts(crawl(), [{ id: '200', timestamp: 200, tags: ['other'] }]).snapshot

    expect(updated.posts.map(post => post.id)).toEqual(['300', '200', '100'])
  })

  it('a timestamp rewritten by Tumblr moves the post', () => {
    const updated = mergePosts(crawl(), [{ id: '100', timestamp: 999, tags: ['a'] }]).snapshot

    expect(updated.posts.map(post => post.id)).toEqual(['100', '300', '200'])
  })

  it('on equal timestamps the larger id comes first', () => {
    const snapshot = mergePosts(emptySnapshot('b'), [
      { id: '100', timestamp: 7, tags: [] },
      { id: '781234567890123456', timestamp: 7, tags: [] },
      { id: '900', timestamp: 7, tags: [] },
    ]).snapshot

    expect(snapshot.posts.map(post => post.id)).toEqual(['781234567890123456', '900', '100'])
  })

  it('reading repairs a file written in the wrong order', () => {
    const broken = JSON.stringify({
      schema: 2,
      blog: 'b',
      generatedAt: '2026-01-01T00:00:00.000Z',
      totalPosts: 2,
      tags: ['a'],
      posts: [
        { id: '100', timestamp: 100, tags: [0] },
        { id: '400', timestamp: 400, tags: [0] },
      ],
    })

    expect(parseSnapshot(broken).posts.map(post => post.id)).toEqual(['400', '100'])
  })

  it('sortPosts leaves the source array alone', () => {
    const posts = crawl().posts
    const copy = [...posts]

    sortPosts(posts)

    expect(posts).toEqual(copy)
  })
})
