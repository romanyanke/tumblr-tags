import { describe, expect, it, vi } from 'vitest'
import { syncPosts, syncSnapshot } from '../../src/collect.js'
import { emptySnapshot, mergePosts } from '../../src/snapshot/schema.js'
import type { Snapshot, SyncProgress } from '../../src/types.js'
import { mockFetch, postsResponse } from '../helpers/mock-fetch.js'

const creds = { blog: 'me-yanke', consumerKey: 'key' }
const fast = { minRequestIntervalMs: 0, retry: { baseDelayMs: 5, jitter: 0 } }

const page = (ids: string[], total: number, tags: string[] = ['тег']) => ({
  body: postsResponse(
    ids.map(id => ({ id, timestamp: Number(id), tags })),
    total,
  ),
})

describe('syncSnapshot', () => {
  it('обходит блог постранично', async () => {
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

  it('сдвигает смещение на число полученных постов, а не на запрошенное', async () => {
    // API вправе отдать меньше, чем просили: 1.x в этом случае перескакивала посты.
    const { fetch, urls } = mockFetch([page(['9'], 3), page(['8'], 3), page(['7'], 3)])

    await syncSnapshot(creds, emptySnapshot('me-yanke'), { ...fast, fetch, pageSize: 50 })

    expect(urls[1]).toContain('offset=1')
    expect(urls[2]).toContain('offset=2')
  })

  it('останавливается на первой полностью известной странице', async () => {
    const existing = mergePosts(emptySnapshot('me-yanke'), [
      { id: '4', timestamp: 4, tags: ['тег'] },
      { id: '3', timestamp: 3, tags: ['тег'] },
    ]).snapshot

    const { fetch, urls } = mockFetch([page(['5'], 5), page(['4'], 5), page(['3'], 5)])
    const result = await syncSnapshot({ ...creds }, existing, { ...fast, fetch, pageSize: 1 })

    expect(result.postsAdded).toBe(1)
    expect(result.stoppedBecause).toBe('up-to-date')
    expect(urls).toHaveLength(2)
  })

  it('с флагом full обходит всё и забывает удалённые посты', async () => {
    const existing = mergePosts(emptySnapshot('me-yanke'), [
      { id: '9', timestamp: 9, tags: ['старый'] },
    ]).snapshot

    const { fetch } = mockFetch([page(['2', '1'], 2)])
    const result = await syncSnapshot(creds, existing, { ...fast, fetch, full: true, pageSize: 2 })

    expect(result.snapshot.posts.map(post => post.id)).toEqual(['2', '1'])
    expect(result.complete).toBe(true)
  })

  it('останавливается на исчерпанном бюджете и сохраняет собранное', async () => {
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

  it('бюджет тратят и повторы', async () => {
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

  it('на исчерпанном лимите Tumblr отдаёт снапшот, а не бросает', async () => {
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

  it('по отмене возвращает собранное, а не выбрасывает его', async () => {
    const controller = new AbortController()
    const { fetch } = mockFetch([page(['9'], 100), page(['8'], 100)])

    const result = await syncSnapshot(creds, emptySnapshot('me-yanke'), {
      ...fast,
      fetch,
      pageSize: 1,
      signal: controller.signal,
      onCheckpoint: () => controller.abort(new Error('прервано')),
    })

    expect(result.stoppedBecause).toBe('aborted')
    expect(result.snapshot.posts).toHaveLength(1)
  })

  it('зовёт контрольную точку после каждой страницы', async () => {
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

  it('сообщает о ходе работы вместо печати в консоль', async () => {
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

  it('пробрасывает отказ авторизации', async () => {
    const { fetch } = mockFetch([{ status: 401 }])

    await expect(
      syncSnapshot(creds, emptySnapshot('me-yanke'), { ...fast, fetch }),
    ).rejects.toThrow(/consumer key/i)
  })

  it('выдерживает пустой блог', async () => {
    const { fetch } = mockFetch([page([], 0)])
    const result = await syncSnapshot(creds, emptySnapshot('me-yanke'), { ...fast, fetch })

    expect(result.snapshot.posts).toEqual([])
    expect(result.complete).toBe(true)
  })

  it('выдерживает паузу между запросами', async () => {
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
  it('перечитывает названные посты по одному', async () => {
    const { fetch, urls } = mockFetch([
      { body: postsResponse([{ id: '2', tags: ['новый'] }], 10) },
      { body: postsResponse([{ id: '1', tags: ['другой'] }], 10) },
    ])

    const result = await syncPosts(creds, emptySnapshot('me-yanke'), ['2', '1'], { ...fast, fetch })

    expect(urls).toHaveLength(2)
    expect(urls[0]).toContain('id=2')
    expect(result.postsAdded).toBe(2)
    expect(result.complete).toBe(true)
  })

  it('обновляет пост, уже лежащий в снапшоте', async () => {
    const existing = mergePosts(emptySnapshot('me-yanke'), [
      { id: '1', timestamp: 1, tags: ['было'] },
    ]).snapshot

    const { fetch } = mockFetch([{ body: postsResponse([{ id: '1', tags: ['стало'] }], 1) }])
    const result = await syncPosts(creds, existing, ['1'], { ...fast, fetch })

    expect(result.postsUpdated).toBe(1)
    expect(result.snapshot.posts).toHaveLength(1)
    expect(result.snapshot.posts[0]?.tags.map(id => result.snapshot.tags[id])).toEqual(['стало'])
  })

  it('пропавший пост не валит прогон', async () => {
    const { fetch } = mockFetch([
      { status: 404 },
      { body: postsResponse([{ id: '1', tags: ['есть'] }], 5) },
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
