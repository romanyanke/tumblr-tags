import tumblr from 'tumblr.js'
import path from 'path'
import fs from 'fs'
import { Result, TumblrTagsOptions, TumblrPost } from './interface'
import { countTotalRequests, getLimitOffset, getParentModuleDir, normalizePathName } from './utils'
import { processCache, readCache } from './cache'
import { parseTags } from './parser'

export const parseTumblrPosts = async ({
  config: { outPath = 'dist', cachePath = 'tmp', blog: blogName, consumerKey, transform },
  requestedPostIds,
}: TumblrTagsOptions) => {
  const paths = {
    cache: normalizePathName(path.resolve(getParentModuleDir(), cachePath), 'source.json'),
    dist: normalizePathName(path.resolve(getParentModuleDir(), outPath), 'tags.json'),
  }

  const requiredFolders = [paths.cache, paths.dist]
  requiredFolders.forEach(path => {
    if (!fs.existsSync(path.dirname)) {
      fs.mkdirSync(path.dirname)
    }
  })

  const storedCache = processCache(readCache(paths.cache.path))
  const client = tumblr.createClient({ consumer_key: consumerKey })
  const cachedPostsCount = storedCache.countCachedPosts()

  const POSTS_PER_REQUEST = 50
  const totalPosts = await (() =>
    new Promise<number>((resolve, reject) => {
      client.blogInfo(blogName, (err, data) => {
        if (err) {
          reject(err)
        }

        resolve(data.blog.total_posts)
      })
    }))()
  const newPosts = totalPosts - cachedPostsCount
  const requestsNeeded = countTotalRequests({ totalPosts: newPosts, limit: POSTS_PER_REQUEST })

  let iteration = 0

  function* generateRequest() {
    while (iteration < requestsNeeded) {
      yield makePageRequest(iteration++)
    }
  }

  const makePageRequest = (requestIndex: number) =>
    new Promise<TumblrPost[]>((resolve, reject) => {
      console.log(`Request ${requestIndex}/${requestsNeeded}`)

      const limitOffset = getLimitOffset({
        cachedPosts: cachedPostsCount,
        iteration: requestIndex,
        limit: POSTS_PER_REQUEST,
        totalPosts,
      })

      client.blogPosts(blogName, limitOffset, (err, data: { posts: TumblrPost[] }) => {
        if (err) {
          reject(err)
        }

        resolve(data.posts)
      })
    })

  const makePostRequest = (postId: number) =>
    new Promise<TumblrPost>((resolve, reject) => {
      client.blogPosts(blogName, { id: postId }, (err, data: { posts: TumblrPost[] }) => {
        if (err) {
          reject(err)
        }

        const post = data?.posts[0]

        if (!post) {
          reject(`Can't find post ${postId}`)
        }

        resolve(post)
      })
    })

  const parseBlog = async (): Promise<Result> => {
    const request = generateRequest()

    console.log(`
      Posts in "${blogName}": ${totalPosts}.
      Cached posts: ${cachedPostsCount}.
      Requests to be sent: ${requestsNeeded}.
  `)

    while (requestsNeeded > 0) {
      try {
        const next = request.next()

        if (next.done) {
          break
        }

        const posts = await next.value
        posts.forEach(storedCache.addPost)
      } catch ({ message }) {
        const data: Result = {
          errorMessage: message,
          postProcessed: cachedPostsCount + iteration * POSTS_PER_REQUEST,
          totalPosts,
        }

        throw data
      }
    }

    return { postProcessed: totalPosts, totalPosts }
  }

  const writeDataToDisk = () => {
    const data = storedCache.getCache()
    const parsed = parseTags(data, { transform })

    fs.writeFileSync(paths.cache.path, JSON.stringify(data), 'utf-8')
    fs.writeFileSync(paths.dist.path, JSON.stringify(parsed), 'utf-8')
  }

  process.on('SIGINT', () => {
    writeDataToDisk()
    process.exit()
  })

  if (requestedPostIds) {
    const requests = await Promise.allSettled(requestedPostIds.map(id => makePostRequest(id)))
    requests.forEach(request => {
      if (request.status === 'fulfilled') {
        storedCache.addPost(request.value)
      }
    })
    const requestedCount = requests.length
    const successCount = requests.filter(request => request.status === 'fulfilled').length
    const rejectedCount = requests.filter(request => request.status === 'rejected').length
    console.log(`
      Requested posts: ${requestedCount}
      Successful: ${successCount}
      Rejected: ${rejectedCount}
`)
    writeDataToDisk()
  } else {
    return parseBlog()
      .then(data => {
        console.log(`
      All ${data.totalPosts} post(s) are parsed and saved.
  `)
        writeDataToDisk()
      })
      .catch((data: Result) => {
        console.error(`
        ${iteration - 1} request(s) are succesfully sent.
        ${data.postProcessed}/${data.totalPosts} post(s) parsed and saved.
        To continue parsing try again later.
        Exit with error: "${data.errorMessage}"
  `)
        writeDataToDisk()
      })
  }
}
