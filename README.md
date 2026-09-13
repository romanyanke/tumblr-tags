# tumblr-tags

[![npm](https://img.shields.io/npm/v/tumblr-tags.svg)](https://www.npmjs.com/package/tumblr-tags)
[![CI](https://github.com/romanyanke/tumblr-tags/actions/workflows/ci.yml/badge.svg)](https://github.com/romanyanke/tumblr-tags/actions/workflows/ci.yml)

Collects every tag used in the posts of a Tumblr blog, keeps an incremental snapshot
of the blog, and writes a tag file you can turn into a tag cloud or a search index.

Ships a library and a `ttags` command. ESM-only, Node 22.12+, **zero runtime dependencies**.

```bash
npm install tumblr-tags --save-dev
```

## Prerequisites

- A [Tumblr application](https://www.tumblr.com/oauth/apps).
- Its OAuth consumer key, exported as `TUMBLR_CONSUMER_KEY`.

The key is only ever read from the environment or the config file: there is no
`--consumer-key` flag, so it cannot end up in shell history or CI logs.

## Command line

```bash
export TUMBLR_CONSUMER_KEY=…
npx ttags --blog my-blog
```

That crawls the blog, writes the snapshot to `tmp/source.json` and the tag counts to
`dist/tags.json`. Run it again later and it only fetches what appeared since: the crawl
goes newest-first and stops at the first page it already knows.

| Command | What it does |
| --- | --- |
| `ttags` / `ttags sync` | crawl the blog and update the snapshot |
| `ttags post <id…>` | re-read the named posts (use it after retagging in Tumblr) |
| `ttags tags` | rebuild the tag file from the snapshot, without touching the network |
| `ttags --help` / `ttags --version` | usage and version |

| Option | Default | Description |
| --- | --- | --- |
| `-c, --config <path>` | `ttags.config.*` | config file |
| `--blog <name>` | | blog name, overrides the config |
| `--snapshot <file>` | `tmp/source.json` | snapshot file |
| `--out <file>` | `dist/tags.json` | tag file |
| `--min-count <n>` | `1` | drop tags used in fewer than n posts |
| `--max-requests <n>` | `300` | request budget for one run |
| `--page-size <n>` | `20` | posts per request |
| `--timeout <ms>` | `15000` | per-request timeout |
| `--retries <n>` | `5` | attempts per request |
| `--full` | | crawl everything, don't stop at known posts |
| `--compact` | | drop tags no post uses and renumber the rest |
| `--dry-run` | | write nothing to disk |
| `--no-tags` | | don't rebuild the tag file |
| `--json` | | newline-delimited JSON events on stdout |
| `-q, --quiet` / `-v, --verbose` | | output level |

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | done |
| 1 | unexpected error |
| 2 | bad arguments or missing config |
| 3 | incomplete: request budget, Tumblr rate limit or interrupted run; snapshot saved |
| 4 | Tumblr rejected the consumer key |
| 5 | blog not found |

Code 3 is the one worth handling in CI — it means "come back later", not "something broke".
An interrupted run (Ctrl+C, or a runner preempted with SIGTERM) reports it too, so a wrapper
cannot mistake a half-finished crawl for a successful one:

```bash
npx ttags || [ $? -eq 3 ]
```

Transient failures never reach it: empty responses, 5xx and dropped connections are
retried inside the process with exponential backoff.

## Configuration

Put a `ttags.config.js`, `.mjs`, `.cjs` or `.json` in the directory you run `ttags` from,
or a `ttags` field in package.json. Paths are resolved against the current directory.

```js
export default {
  blog: 'my-blog',
  snapshot: 'tmp/source.json',
  out: 'dist/tags.json',
  minCount: 2,
  maxRequests: 300,
}
```

| Key | Required | Default | Description |
| --- | --- | --- | --- |
| `blog` | yes | | blog name |
| `consumerKey` | | | prefer `TUMBLR_CONSUMER_KEY` |
| `snapshot` | | `tmp/source.json` | snapshot file |
| `out` | | `dist/tags.json` | tag file |
| `minCount` | | `1` | drop tags used in fewer than n posts |
| `maxRequests` | | `300` | request budget for one run |
| `pageSize` | | `20` | posts per request |

## Rate limits

Tumblr allows 1000 requests per hour and 5000 per day per consumer key. A full crawl of a
15 000-post blog is about 300 requests at `--page-size 50`, so the default budget of 300
leaves room for whatever else uses the same key. Retries spend the budget too.

When the hourly window runs out, `ttags` saves what it has and exits with code 3 rather
than holding the process for up to an hour — the next run picks up where it stopped.

## Library

Every function is a named export. Fetching, file access and aggregation are separate:
nothing writes to disk behind your back, and nothing prints.

```js
import {
  readSnapshotIfExists,
  emptySnapshot,
  syncSnapshot,
  writeSnapshot,
  countTags,
  writeTagCounts,
} from 'tumblr-tags'

const path = 'tmp/source.json'
const snapshot = (await readSnapshotIfExists(path)) ?? emptySnapshot('my-blog')

const result = await syncSnapshot(
  { blog: 'my-blog', consumerKey: process.env.TUMBLR_CONSUMER_KEY },
  snapshot,
  {
    maxRequests: 300,
    onProgress: p => process.stderr.write(`\r${p.postsSeen}/${p.totalPosts ?? '?'}`),
    onCheckpoint: s => writeSnapshot(path, s),
  },
)

await writeSnapshot(path, result.snapshot)
await writeTagCounts('dist/tags.json', countTags(result.snapshot, { minCount: 2 }))

if (!result.complete) {
  console.error(`stopped early: ${result.stoppedBecause}`)
}
```

Fetching without writing anything:

```js
const { snapshot } = await syncSnapshot(credentials, emptySnapshot('my-blog'), { maxRequests: 5 })
console.log(countTags(snapshot, { sort: 'count' }).slice(0, 10))
```

### Exports

**Fetching** — `syncSnapshot`, `syncPosts`, `fetchPostPages`, `TumblrClient`.
`syncSnapshot` and `syncPosts` return `{snapshot, complete, requests, postsAdded,
postsUpdated, stoppedBecause?, missingPosts?}` and never touch the filesystem.

**Files** — `readSnapshot`, `readSnapshotIfExists`, `writeSnapshot`, `writeTagCounts`,
`parseSnapshot`, `serializeSnapshot`. Writes go through a temporary file and a rename,
so an interrupted process cannot leave a truncated snapshot.

**Aggregation** — `countTags(snapshot, {minCount, sort, locale})` → `[{tag, count}]`.

**Snapshot operations** — `emptySnapshot`, `mergePosts`, `tagName`, `tagId`, `tagIndex`,
`postTags`, `findPost`, `postsByTag`, `unusedTags`, `compactTags`, `upsertPost`,
`removePosts`.

**Errors** — `TumblrApiError`, `TumblrAuthError`, `TumblrNotFoundError`,
`TumblrRateLimitError`, `SnapshotSchemaError`. They are thrown, not swallowed.

### Cancelling

Pass an `AbortSignal`. On abort `syncSnapshot` **resolves** with whatever it collected and
`stoppedBecause: 'aborted'` — rejecting would throw away the work the run already paid for.

## Snapshot format

`tmp/source.json` is a documented contract, not an internal cache: read it, ship it,
build your own indexes from it.

```json
{
  "schema": 2,
  "blog": "my-blog",
  "generatedAt": "2026-09-12T09:00:00.000Z",
  "totalPosts": 15113,
  "tags": ["berlin", "panda", "reactor"],
  "posts": [{ "id": "139236866355", "timestamp": 1455000000, "tags": [0, 2] }]
}
```

- `tags` is dense: the array index **is** the tag id, so there is no reverse lookup to
  build and no gaps to work around.
- `posts` is ordered newest-first, ids are strings (Tumblr ids outgrow `Number.MAX_SAFE_INTEGER`),
  and a post never carries the same tag twice.
- Tag ids are stable while a run only adds posts. `compactTags` renumbers them, which is
  why it is never applied automatically.

`dist/tags.json` stays a flat list:

```json
[{ "tag": "my tag", "count": 1 }, { "tag": "another tag", "count": 4 }]
```

## Migrating from 1.x

The snapshot format changed and is **not** converted: delete the old cache file and let
`ttags` crawl the blog once (about 300 requests). Reading a 1.x cache fails with an error
that says exactly that.

| 1.x | 2.0 |
| --- | --- |
| `require('tumblr-tags')` default export | `import { syncSnapshot } from 'tumblr-tags'` |
| `parseTumblrPosts({config, requestedPostIds})` | `syncSnapshot(credentials, snapshot, options)` / `syncPosts(...)` |
| `prepareTags(cache, {transform})` | `countTags(snapshot, {minCount, sort})` |
| `transform: tags => tags.filter(t => t.count > 1)` | `minCount: 2` |
| `ttags.js` with `module.exports` | `ttags.config.js` with `export default` (`.cjs` and `.json` also work) |
| `cachePath: 'tmp'` (directory) | `snapshot: 'tmp/source.json'` (file) |
| `outPath: 'dist'` (directory) | `out: 'dist/tags.json'` (file) |
| `rm tmp/source.json` for a full crawl | `ttags --full` |
| paths relative to the nearest parent package.json | paths relative to the current directory |
| always exits 0 | exit codes 0–5 |
| retry loop around the CLI | retries and a request budget inside |

`tags.json` counts posts per tag now, where 1.x counted occurrences — numbers move
slightly for tags a post carried twice.

## License

ISC
