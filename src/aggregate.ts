import type { CountOptions, Snapshot, TagCount } from './types.js'

/**
 * Counts how many posts each tag appears on.
 *
 * Unlike 1.x, which counted occurrences and kept a post's duplicate tags in the
 * cache, so a post tagged "x x" counted twice.
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
