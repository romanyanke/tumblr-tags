import { CacheTags, TumblrPost } from './interface'
import fs from 'fs'

const getEmptyCache = (): CacheTags => ({ posts: {}, tags: {} })

export const readCache = (path: string): CacheTags =>
  fs.existsSync(path) ? require(path) : getEmptyCache()

export const getNextRecordValue = (record: Record<string, number>) => {
  const values = Object.values(record).sort((a, b) => a - b)
  const lastValue = values[values.length - 1]

  return typeof lastValue === 'number' ? lastValue + 1 : 0
}

export const processCache = (inputCache: CacheTags = getEmptyCache()) => {
  let innerCache: CacheTags = inputCache

  const addPostTag = (postId: string, tag: string) => {
    if (typeof innerCache.tags[tag] === 'undefined') {
      innerCache.tags[tag] = getNextRecordValue(innerCache.tags)
    }

    const tagId = innerCache.tags[tag]
    innerCache.posts[postId] = [...innerCache.posts[postId], tagId]
  }

  const addPost = (post: TumblrPost) => {
    innerCache.posts[post.id] = []

    post.tags.forEach(tag => addPostTag(post.id, tag))
  }

  const getCache = () => innerCache

  const setCache = (newCache: CacheTags) => {
    innerCache = newCache
  }

  const countCachedPosts = () => (innerCache.posts ? Object.keys(innerCache.posts).length : 0)

  return {
    addPost,
    countCachedPosts,
    getCache,
    setCache,
  }
}
