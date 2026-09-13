import { SnapshotSchemaError } from '../errors.js'
import {
  type PostId,
  type RawPost,
  SNAPSHOT_SCHEMA_VERSION,
  type Snapshot,
  type SnapshotPost,
} from '../types.js'

/** An empty snapshot of a blog — where the first crawl starts. */
export const emptySnapshot = (blog: string): Snapshot => ({
  schema: SNAPSHOT_SCHEMA_VERSION,
  blog,
  generatedAt: new Date(0).toISOString(),
  totalPosts: 0,
  tags: [],
  posts: [],
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Validates parsed JSON and returns a snapshot.
 *
 * Schema 1 (`{tags: {name: id}, posts: {postId: [id]}}`) is not converted: it has
 * neither post timestamps nor a total, and a full crawl costs a single run.
 */
export const parseSnapshot = (input: unknown): Snapshot => {
  const value = typeof input === 'string' ? (JSON.parse(input) as unknown) : input

  if (!isRecord(value)) {
    throw new SnapshotSchemaError('Corrupted snapshot file: expected an object.', {
      found: typeof value,
      expected: SNAPSHOT_SCHEMA_VERSION,
    })
  }

  if (value.schema !== SNAPSHOT_SCHEMA_VERSION) {
    const legacy = isRecord(value.tags) && isRecord(value.posts)
    throw new SnapshotSchemaError(
      legacy
        ? 'This is a tumblr-tags 1.x cache. The format changed and is not converted: ' +
            'delete the file and run ttags again to crawl the blog from scratch.'
        : `Unknown snapshot version: ${String(value.schema)}. Expected ${SNAPSHOT_SCHEMA_VERSION}.`,
      { found: value.schema, expected: SNAPSHOT_SCHEMA_VERSION },
    )
  }

  const { blog, generatedAt, totalPosts, tags, posts } = value

  if (
    typeof blog !== 'string' ||
    typeof generatedAt !== 'string' ||
    typeof totalPosts !== 'number'
  ) {
    throw new SnapshotSchemaError(
      'Corrupted snapshot file: blog, generatedAt or totalPosts is missing.',
      {
        found: value.schema,
        expected: SNAPSHOT_SCHEMA_VERSION,
      },
    )
  }

  if (!Array.isArray(tags) || !tags.every(tag => typeof tag === 'string')) {
    throw new SnapshotSchemaError('Corrupted snapshot file: tags must be an array of strings.', {
      found: value.schema,
      expected: SNAPSHOT_SCHEMA_VERSION,
    })
  }

  if (!Array.isArray(posts)) {
    throw new SnapshotSchemaError('Corrupted snapshot file: posts must be an array.', {
      found: value.schema,
      expected: SNAPSHOT_SCHEMA_VERSION,
    })
  }

  return {
    schema: SNAPSHOT_SCHEMA_VERSION,
    blog,
    generatedAt,
    totalPosts,
    tags: tags as string[],
    // Order is restored on read: the file may have been written by a version
    // that appended new posts at the end.
    posts: sortPosts(
      posts.map(post => {
        if (!isRecord(post) || typeof post.id !== 'string' || !Array.isArray(post.tags)) {
          throw new SnapshotSchemaError('Corrupted snapshot file: malformed post entry.', {
            found: post,
            expected: SNAPSHOT_SCHEMA_VERSION,
          })
        }

        return {
          id: post.id,
          timestamp: typeof post.timestamp === 'number' ? post.timestamp : 0,
          tags: (post.tags as unknown[]).filter((id): id is number => typeof id === 'number'),
        }
      }),
    ),
  }
}

export const serializeSnapshot = (snapshot: Snapshot): string => JSON.stringify(snapshot)

/** A post-to-position index so upserts are not a linear scan. */
export const postIndex = (snapshot: Snapshot): Map<PostId, number> =>
  new Map(snapshot.posts.map((post, index) => [post.id, index]))

/** A tag-name-to-id index. */
export const tagIndex = (snapshot: Snapshot): Map<string, number> =>
  new Map(snapshot.tags.map((tag, id) => [tag, id]))

/**
 * Compares post ids numerically without parsing them: Tumblr ids run up to
 * 18 digits, which `Number` cannot hold exactly.
 */
const compareIds = (a: PostId, b: PostId): number =>
  a.length === b.length ? (a < b ? -1 : a > b ? 1 : 0) : a.length - b.length

/** Snapshot order: newest first, and on equal timestamps the larger id wins. */
export const comparePosts = (a: SnapshotPost, b: SnapshotPost): number =>
  b.timestamp - a.timestamp || compareIds(b.id, a.id)

/** Puts posts into newest-first order. */
export const sortPosts = (posts: readonly SnapshotPost[]): SnapshotPost[] =>
  [...posts].sort(comparePosts)

/**
 * Merges two already ordered lists. Cheaper than a full sort, which a crawl
 * would otherwise repeat on every page.
 */
const mergeSorted = (
  base: readonly SnapshotPost[],
  fresh: readonly SnapshotPost[],
): SnapshotPost[] => {
  const result: SnapshotPost[] = []
  let left = 0
  let right = 0

  while (left < base.length && right < fresh.length) {
    const next = comparePosts(base[left] as SnapshotPost, fresh[right] as SnapshotPost) <= 0
    result.push((next ? base[left++] : fresh[right++]) as SnapshotPost)
  }

  while (left < base.length) {
    result.push(base[left++] as SnapshotPost)
  }

  while (right < fresh.length) {
    result.push(fresh[right++] as SnapshotPost)
  }

  return result
}

/**
 * Puts posts into the snapshot: known ones are updated in place, new ones are
 * woven in so that newest-first order holds.
 *
 * New tags take the next free ids; existing ids never shift.
 */
export const mergePosts = (
  snapshot: Snapshot,
  incoming: readonly RawPost[],
): { snapshot: Snapshot; added: number; updated: number } => {
  if (incoming.length === 0) {
    return { snapshot, added: 0, updated: 0 }
  }

  const tags = [...snapshot.tags]
  const tagIds = tagIndex(snapshot)
  const posts = [...snapshot.posts]
  const positions = postIndex(snapshot)

  const fresh: SnapshotPost[] = []

  let added = 0
  let updated = 0
  let reordered = false

  for (const post of incoming) {
    const ids: number[] = []

    for (const name of post.tags) {
      let id = tagIds.get(name)

      if (id === undefined) {
        id = tags.length
        tags.push(name)
        tagIds.set(name, id)
      }

      // Tumblr does return duplicates, and consumers count on them being gone.
      if (!ids.includes(id)) {
        ids.push(id)
      }
    }

    const entry = { id: post.id, timestamp: post.timestamp, tags: ids }
    const at = positions.get(post.id)

    if (at === undefined) {
      fresh.push(entry)
      added++
    } else {
      // A known post's timestamp should not change, but if Tumblr rewrote it,
      // the post no longer sits where the order says it should.
      reordered ||= posts[at]?.timestamp !== entry.timestamp
      posts[at] = entry
      updated++
    }
  }

  const ordered = mergeSorted(posts, sortPosts(fresh))

  return {
    snapshot: { ...snapshot, tags, posts: reordered ? sortPosts(ordered) : ordered },
    added,
    updated,
  }
}
