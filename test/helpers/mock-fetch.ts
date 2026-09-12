import { vi } from 'vitest'

export interface Step {
  status?: number
  body?: unknown
  /** Сырое тело: чтобы отдать пустой ответ или неразбираемый JSON. */
  raw?: string
  headers?: Record<string, string>
  throws?: unknown
}

/**
 * fetch по сценарию: шаг на вызов, последний шаг повторяется.
 * Ни одна библиотека моков для этого не нужна — Response глобальный с Node 18.
 */
export const mockFetch = (steps: Step[]) => {
  const urls: string[] = []

  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const index = Math.min(urls.length, steps.length - 1)
    const step = steps[index] as Step

    urls.push(typeof input === 'string' ? input : input.toString())

    // Настоящий fetch на прерванном сигнале бросает, не ходя в сеть.
    if (init?.signal?.aborted) {
      throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })
    }

    if (step.throws) {
      throw step.throws
    }

    const body = step.raw ?? JSON.stringify(step.body ?? { meta: { status: 200 }, response: {} })

    return new Response(body, {
      status: step.status ?? 200,
      headers: { 'content-type': 'application/json', ...step.headers },
    })
  })

  return {
    fetch: fn as unknown as typeof globalThis.fetch,
    urls,
    calls: () => fn.mock.calls.length,
  }
}

/** Ответ /posts в том виде, в каком его отдаёт Tumblr. */
export const postsResponse = (
  posts: Array<{ id: string; timestamp?: number; tags?: string[] }>,
  totalPosts = posts.length,
) => ({
  meta: { status: 200, msg: 'OK' },
  response: {
    total_posts: totalPosts,
    posts: posts.map(post => ({
      id: Number(post.id),
      id_string: post.id,
      timestamp: post.timestamp ?? 1_600_000_000,
      tags: post.tags ?? [],
    })),
  },
})
