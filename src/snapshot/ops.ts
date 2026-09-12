import type { PostId, RawPost, Snapshot, SnapshotPost, TagId } from '../types.js'
import { mergePosts, postIndex, tagIndex } from './schema.js'

export { tagIndex }

/** Имя тега по идентификатору. */
export const tagName = (snapshot: Snapshot, id: TagId): string | undefined => snapshot.tags[id]

/** Идентификатор тега по имени. Для многих поисков подряд возьмите `tagIndex`. */
export const tagId = (snapshot: Snapshot, name: string): TagId | undefined => {
  const id = snapshot.tags.indexOf(name)

  return id === -1 ? undefined : id
}

export const findPost = (snapshot: Snapshot, postId: PostId): SnapshotPost | undefined =>
  snapshot.posts.find(post => post.id === postId)

/** Имена тегов одного поста, в порядке поста. */
export const postTags = (snapshot: Snapshot, postId: PostId): string[] | undefined => {
  const post = findPost(snapshot, postId)

  return post?.tags
    .map(id => snapshot.tags[id])
    .filter((name): name is string => name !== undefined)
}

/** Идентификаторы постов с этим тегом, в порядке снапшота — новые сверху. */
export const postsByTag = (snapshot: Snapshot, tag: string | TagId): PostId[] => {
  const id = typeof tag === 'number' ? tag : tagId(snapshot, tag)

  if (id === undefined) {
    return []
  }

  return snapshot.posts.filter(post => post.tags.includes(id)).map(post => post.id)
}

/** Теги, на которые не ссылается ни один пост. */
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
 * Снапшот без мёртвых тегов и с плотной перенумерацией оставшихся.
 *
 * Идентификаторы тегов при этом меняются, поэтому операция никогда не делается
 * сама собой: внешний код мог их запомнить.
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

/** Вставляет или заменяет один пост. Возвращает новый снапшот. */
export const upsertPost = (snapshot: Snapshot, post: RawPost): Snapshot =>
  mergePosts(snapshot, [post]).snapshot

/** Убирает посты по идентификаторам. Теги при этом не трогаются — см. `compactTags`. */
export const removePosts = (snapshot: Snapshot, ids: Iterable<PostId>): Snapshot => {
  const drop = new Set(ids)

  if (drop.size === 0) {
    return snapshot
  }

  return { ...snapshot, posts: snapshot.posts.filter(post => !drop.has(post.id)) }
}

export { postIndex }
