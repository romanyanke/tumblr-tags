export interface Result {
  errorMessage?: string
  postProcessed: number
  totalPosts: number
}

export interface TumblrPost {
  id: string
  tags: string[]
}

export interface CacheTags {
  tags: Record<string, number>
  posts: Record<string, number[]>
}

export interface TumblrTagsOptions {
  config: TumblrTagsConfig
  requestedPostIds?: number[]
}

export interface TumblrTagsConfig extends TumblrTagsParserOptions {
  consumerKey: string
  blog: string

  cachePath?: string
  outPath?: string
}

export interface TumblrTagsParserOptions {
  transform?<T extends any>(data: ParsedTag[]): T
}

export interface ParsedTag {
  tag: string
  count: number
}

export interface LimitOffsetPayload {
  totalPosts: number
  iteration: number
  cachedPosts: number
  limit: number
}

export interface CountRequestPayload {
  totalPosts: number
  limit: number
}
