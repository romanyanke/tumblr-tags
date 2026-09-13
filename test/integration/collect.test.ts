import { describe, expect, it, vi } from 'vitest'
import { syncPosts, syncSnapshot } from '../../src/collect.js'
import { emptySnapshot, mergePosts } from '../../src/snapshot/schema.js'
import type { Snapshot, SyncProgress } from '../../src/types.js'
import { mockFetch, postsResponse } from '../helpers/mock-fetch.js'

const creds = { blog: 'me-yanke', consumerKey: 'key' }
const fast = { minRequestIntervalMs: 0, retry: { baseDelayMs: 5, jitter: 0 } }

const page = (ids: string[], total: number, tags: string[] = ['tag']) => ({
  body: postsResponse(
    ids.map(id => ({ id, timestamp: Number(id), tags })),
    total,
  ),
})

describe('syncSnapshot', () => {
  it('crawls the blog page by page', async () => {
    const { fetch, urls } = mockFetch([page(['5', '4'], 5), page(['3', '2'], 5), page(['1'], 5)])

    const result = await syncSnapshot(creds, emptySnapshot('me-yanke'), {
      ...fast,
      fetch,
      pageSize: 2,
    })

    expect(result.snapshot.posts.map(post => post.id)).toEqual(['5', '4', '3', '2', '1'])
    expect(result.complete).toBe(true)
    expect(result.postsAdded).toBe(5)
    expect(urls).toHaveLength(3)
    expect(urls[1]).toContain('offset=2')
  })

  it('advances the offset by posts received, not by the size requested', async () => {
    // The API may return fewer than asked for: 1.x skipped posts in that case.
    const { fetch, urls } = mockFetch([page(['9'], 3), page(['8'], 3), page(['7'], 3)])

    await syncSnapshot(creds, emptySnapshot('me-yanke'), { ...fast, fetch, pageSize: 50 })

    expect(urls[1]).toContain('offset=1')
    expect(urls[2]).toContain('offset=2')
  })

  it('stops at the first page it already knows in full', async () => {
    const existing = mergePosts(emptySnapshot('me-yanke'), [
      { id: '4', timestamp: 4, tags: ['tag'] },
      { id: '3', timestamp: 3, tags: ['tag'] },
    ]).snapshot

    const { fetch, urls } = mockFetch([page(['5'], 5), page(['4'], 5), page(['3'], 5)])
    const result = await syncSnapshot({ ...creds }, existing, { ...fast, fetch, pageSize: 1 })

    expect(result.postsAdded).toBe(1)
    expect(result.stoppedBecause).toBe('up-to-date')
    expect(urls).toHaveLength(2)
  })

  it('with full it crawls everything and forgets deleted posts', async () => {
    const existing = mergePosts(emptySnapshot('me-yanke'), [
      { id: '9', timestamp: 9, tags: ['old'] },
    ]).snapshot

    const { fetch } = mockFetch([page(['2', '1'], 2)])
    const result = await syncSnapshot(creds, existing, { ...fast, fetch, full: true, pageSize: 2 })

    expect(result.snapshot.posts.map(post => post.id)).toEqual(['2', '1'])
    expect(result.complete).toBe(true)
  })

  it('stops on a spent budget and keeps what it collected', async () => {
    const { fetch, urls } = mockFetch([
      page(['9', '8'], 100),
      page(['7', '6'], 100),
      page(['5', '4'], 100),
    ])

    const result = await syncSnapshot(creds, emptySnapshot('me-yanke'), {
      ...fast,
      fetch,
      pageSize: 2,
      maxRequests: 2,
    })

    expect(urls).toHaveLength(2)
    expect(result.stoppedBecause).toBe('budget')
    expect(result.complete).toBe(false)
    expect(result.snapshot.posts.length).toBeGreaterThan(0)
  })

  it('retries spend the budget too', async () => {
    const { fetch, calls } = mockFetch([{ status: 500 }])
    const result = await syncSnapshot(creds, emptySnapshot('me-yanke'), {
      ...fast,
      fetch,
      maxRequests: 3,
      retry: { attempts: 10, baseDelayMs: 1, jitter: 0 },
    })

    expect(calls()).toBe(3)
    expect(result.stoppedBecause).toBe('budget')
  })

  it('on a Tumblr rate limit it returns the snapshot instead of throwing', async () => {
    const { fetch } = mockFetch([
      page(['9'], 10),
      { status: 429, headers: { 'x-ratelimit-perhour-reset': '3000' } },
    ])

    const result = await syncSnapshot(creds, emptySnapshot('me-yanke'), {
      ...fast,
      fetch,
      pageSize: 1,
    })

    expect(result.stoppedBecause).toBe('rate-limit')
    expect(result.snapshot.posts).toHaveLength(1)
    expect(result.complete).toBe(false)
  })

  it('on abort it returns what it collected instead of discarding it', async () => {
    const controller = new AbortController()
    const { fetch } = mockFetch([page(['9'], 100), page(['8'], 100)])

    const result = await syncSnapshot(creds, emptySnapshot('me-yanke'), {
      ...fast,
      fetch,
      pageSize: 1,
      signal: controller.signal,
      onCheckpoint: () => controller.abort(new Error('interrupted')),
    })

    expect(result.stoppedBecause).toBe('aborted')
    expect(result.snapshot.posts).toHaveLength(1)
  })

  it('calls the checkpoint after every page', async () => {
    const seen: number[] = []
    const { fetch } = mockFetch([page(['3'], 3), page(['2'], 3), page(['1'], 3)])

    await syncSnapshot(creds, emptySnapshot('me-yanke'), {
      ...fast,
      fetch,
      pageSize: 1,
      onCheckpoint: (snapshot: Snapshot) => {
        seen.push(snapshot.posts.length)
      },
    })

    expect(seen).toEqual([1, 2, 3])
  })

  it('reports progress instead of printing to the console', async () => {
    const progress: SyncProgress[] = []
    const { fetch } = mockFetch([page(['2', '1'], 2)])

    await syncSnapshot(creds, emptySnapshot('me-yanke'), {
      ...fast,
      fetch,
      pageSize: 2,
      onProgress: p => progress.push(p),
    })

    expect(progress.at(-1)?.phase).toBe('done')
    expect(progress.some(p => p.postsSeen === 2 && p.totalPosts === 2)).toBe(true)
  })

  it('propagates an authorization failure', async () => {
    const { fetch } = mockFetch([{ status: 401 }])

    await expect(
      syncSnapshot(creds, emptySnapshot('me-yanke'), { ...fast, fetch }),
    ).rejects.toThrow(/consumer key/i)
  })

  it('survives an empty blog', async () => {
    const { fetch } = mockFetch([page([], 0)])
    const result = await syncSnapshot(creds, emptySnapshot('me-yanke'), { ...fast, fetch })

    expect(result.snapshot.posts).toEqual([])
    expect(result.complete).toBe(true)
  })

  it('keeps a pause between requests', async () => {
    const { fetch } = mockFetch([page(['2'], 2), page(['1'], 2)])
    const sleeps: number[] = []
    const realSetTimeout = globalThis.setTimeout

    vi.stubGlobal('setTimeout', ((fn: () => void, ms?: number) => {
      sleeps.push(ms ?? 0)

      return realSetTimeout(fn, 0)
    }) as typeof setTimeout)

    await syncSnapshot(creds, emptySnapshot('me-yanke'), {
      fetch,
      pageSize: 1,
      minRequestIntervalMs: 250,
    })

    vi.unstubAllGlobals()
    expect(sleeps.some(ms => ms > 0 && ms <= 250)).toBe(true)
  })
})

describe('syncPosts', () => {
  it('re-reads the named posts one at a time', async () => {
    const { fetch, urls } = mockFetch([
      { body: postsResponse([{ id: '2', tags: ['fresh'] }], 10) },
      { body: postsResponse([{ id: '1', tags: ['other'] }], 10) },
    ])

    const result = await syncPosts(creds, emptySnapshot('me-yanke'), ['2', '1'], { ...fast, fetch })

    expect(urls).toHaveLength(2)
    expect(urls[0]).toContain('id=2')
    expect(result.postsAdded).toBe(2)
    expect(result.complete).toBe(true)
  })

  it('updates a post already present in the snapshot', async () => {
    const existing = mergePosts(emptySnapshot('me-yanke'), [
      { id: '1', timestamp: 1, tags: ['before'] },
    ]).snapshot

    const { fetch } = mockFetch([{ body: postsResponse([{ id: '1', tags: ['after'] }], 1) }])
    const result = await syncPosts(creds, existing, ['1'], { ...fast, fetch })

    expect(result.postsUpdated).toBe(1)
    expect(result.snapshot.posts).toHaveLength(1)
    expect(result.snapshot.posts[0]?.tags.map(id => result.snapshot.tags[id])).toEqual(['after'])
  })

  it('a missing post does not fail the run', async () => {
    const { fetch } = mockFetch([
      { status: 404 },
      { body: postsResponse([{ id: '1', tags: ['present'] }], 5) },
    ])

    const result = await syncPosts(creds, emptySnapshot('me-yanke'), ['404', '1'], {
      ...fast,
      fetch,
    })

    expect(result.missingPosts).toEqual(['404'])
    expect(result.postsAdded).toBe(1)
    expect(result.complete).toBe(false)
  })
})
