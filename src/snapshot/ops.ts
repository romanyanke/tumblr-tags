import type { PostId, RawPost, Snapshot, SnapshotPost, TagId } from '../types.js'
import { mergePosts, postIndex, tagIndex } from './schema.js'

export { tagIndex }

/** A tag's name by its id. */
export const tagName = (snapshot: Snapshot, id: TagId): string | undefined => snapshot.tags[id]

/** A tag's id by name. For many lookups in a row use `tagIndex`. */
export const tagId = (snapshot: Snapshot, name: string): TagId | undefined => {
  const id = snapshot.tags.indexOf(name)

  return id === -1 ? undefined : id
}

export const findPost = (snapshot: Snapshot, postId: PostId): SnapshotPost | undefined =>
  snapshot.posts.find(post => post.id === postId)

/** Tag names of a single post, in the post's own order. */
export const postTags = (snapshot: Snapshot, postId: PostId): string[] | undefined => {
  const post = findPost(snapshot, postId)

  return post?.tags
    .map(id => snapshot.tags[id])
    .filter((name): name is string => name !== undefined)
}

/** Ids of posts carrying this tag, in snapshot order — newest first. */
export const postsByTag = (snapshot: Snapshot, tag: string | TagId): PostId[] => {
  const id = typeof tag === 'number' ? tag : tagId(snapshot, tag)

  if (id === undefined) {
    return []
  }

  return snapshot.posts.filter(post => post.tags.includes(id)).map(post => post.id)
}

/** Tags no post refers to. */
export const unusedTags = (snapshot: Snapshot): string[] => {
  const used = new Set<TagId>()

  for (const post of snapshot.posts) {
    for (const id of post.tags) {
      used.add(id)
    }
  }

  return snapshot.tags.filter((_, id) => !used.has(id))
}

/**
 * A snapshot without dead tags, with the remaining ones densely renumbered.
 *
 * Tag ids change as a result, which is why this never happens on its own:
 * outside code may have remembered them.
 */
export const compactTags = (snapshot: Snapshot): Snapshot => {
  const used = new Set<TagId>()

  for (const post of snapshot.posts) {
    for (const id of post.tags) {
      used.add(id)
    }
  }

  const remap = new Map<TagId, TagId>()
  const tags: string[] = []

  snapshot.tags.forEach((name, id) => {
    if (used.has(id)) {
      remap.set(id, tags.length)
      tags.push(name)
    }
  })

  return {
    ...snapshot,
    tags,
    posts: snapshot.posts.map(post => ({
      ...post,
      tags: post.tags.map(id => remap.get(id)).filter((id): id is TagId => id !== undefined),
    })),
  }
}

/** Inserts or replaces a single post. Returns a new snapshot. */
export const upsertPost = (snapshot: Snapshot, post: RawPost): Snapshot =>
  mergePosts(snapshot, [post]).snapshot

/** Drops posts by id. Tags are left alone — see `compactTags`. */
export const removePosts = (snapshot: Snapshot, ids: Iterable<PostId>): Snapshot => {
  const drop = new Set(ids)

  if (drop.size === 0) {
    return snapshot
  }

  return { ...snapshot, posts: snapshot.posts.filter(post => !drop.has(post.id)) }
}

export { postIndex }
