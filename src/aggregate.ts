import type { CountOptions, Snapshot, TagCount } from './types.js'

/**
 * Считает, во скольких постах встречается каждый тег.
 *
 * Отличие от 1.x: там считались вхождения, а повторы тега внутри поста попадали
 * в кеш, поэтому пост с тегом «x x» давал двойку.
 */
export const countTags = (snapshot: Snapshot, options: CountOptions = {}): TagCount[] => {
  const { minCount = 1, sort = 'name', locale } = options
  const counts = new Array<number>(snapshot.tags.length).fill(0)

  for (const post of snapshot.posts) {
    for (const id of post.tags) {
      const current = counts[id]

      if (current !== undefined) {
        counts[id] = current + 1
      }
    }
  }

  const tags: TagCount[] = []

  snapshot.tags.forEach((tag, id) => {
    const count = counts[id] ?? 0

    if (count >= minCount) {
      tags.push({ tag, count })
    }
  })

  return tags.sort((a, b) =>
    sort === 'count'
      ? b.count - a.count || a.tag.localeCompare(b.tag, locale)
      : a.tag.localeCompare(b.tag, locale),
  )
}
