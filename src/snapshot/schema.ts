import { SnapshotSchemaError } from '../errors.js'
import { type PostId, type RawPost, SNAPSHOT_SCHEMA_VERSION, type Snapshot } from '../types.js'

/** Пустой снапшот блога — с него начинается первый обход. */
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
 * Проверяет разобранный JSON и возвращает снапшот.
 *
 * Схему 1 (`{tags: {имя: id}, posts: {postId: [id]}}`) не конвертирует: у неё нет
 * ни времени постов, ни общего их числа, а полный обход блога стоит один прогон.
 */
export const parseSnapshot = (input: unknown): Snapshot => {
  const value = typeof input === 'string' ? (JSON.parse(input) as unknown) : input

  if (!isRecord(value)) {
    throw new SnapshotSchemaError('Файл снапшота повреждён: ожидался объект.', {
      found: typeof value,
      expected: SNAPSHOT_SCHEMA_VERSION,
    })
  }

  if (value.schema !== SNAPSHOT_SCHEMA_VERSION) {
    const legacy = isRecord(value.tags) && isRecord(value.posts)
    throw new SnapshotSchemaError(
      legacy
        ? 'Это кеш tumblr-tags 1.x. Формат сменился и не конвертируется: удалите файл ' +
            'и запустите ttags снова — блог будет обойдён заново.'
        : `Неизвестная версия снапшота: ${String(value.schema)}. Ожидалась ${SNAPSHOT_SCHEMA_VERSION}.`,
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
      'Файл снапшота повреждён: нет blog, generatedAt или totalPosts.',
      {
        found: value.schema,
        expected: SNAPSHOT_SCHEMA_VERSION,
      },
    )
  }

  if (!Array.isArray(tags) || !tags.every(tag => typeof tag === 'string')) {
    throw new SnapshotSchemaError('Файл снапшота повреждён: tags должен быть массивом строк.', {
      found: value.schema,
      expected: SNAPSHOT_SCHEMA_VERSION,
    })
  }

  if (!Array.isArray(posts)) {
    throw new SnapshotSchemaError('Файл снапшота повреждён: posts должен быть массивом.', {
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
    posts: posts.map(post => {
      if (!isRecord(post) || typeof post.id !== 'string' || !Array.isArray(post.tags)) {
        throw new SnapshotSchemaError('Файл снапшота повреждён: некорректная запись поста.', {
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
  }
}

export const serializeSnapshot = (snapshot: Snapshot): string => JSON.stringify(snapshot)

/** Ключ «пост → позиция», чтобы upsert не был линейным поиском. */
export const postIndex = (snapshot: Snapshot): Map<PostId, number> =>
  new Map(snapshot.posts.map((post, index) => [post.id, index]))

/** Ключ «имя тега → идентификатор». */
export const tagIndex = (snapshot: Snapshot): Map<string, number> =>
  new Map(snapshot.tags.map((tag, id) => [tag, id]))

/**
 * Кладёт посты в снапшот: известные обновляет на месте, новые дописывает.
 * Новые теги получают следующие свободные идентификаторы, старые не сдвигаются.
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

  let added = 0
  let updated = 0

  for (const post of incoming) {
    const ids: number[] = []

    for (const name of post.tags) {
      let id = tagIds.get(name)

      if (id === undefined) {
        id = tags.length
        tags.push(name)
        tagIds.set(name, id)
      }

      // Tumblr отдаёт повторы, а потребители снапшота рассчитывают на их отсутствие.
      if (!ids.includes(id)) {
        ids.push(id)
      }
    }

    const entry = { id: post.id, timestamp: post.timestamp, tags: ids }
    const at = positions.get(post.id)

    if (at === undefined) {
      positions.set(post.id, posts.length)
      posts.push(entry)
      added++
    } else {
      posts[at] = entry
      updated++
    }
  }

  return { snapshot: { ...snapshot, tags, posts }, added, updated }
}
