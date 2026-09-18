# Changelog

All notable changes to this project will be documented in this file.
The format follows [Conventional Commits](https://www.conventionalcommits.org/),
and the project adheres to [Semantic Versioning](https://semver.org/).

## [2.0.0](https://github.com/romanyanke/tumblr-tags/compare/v1.0.3...v2.0.0) (2026-09-18)

### ⚠ BREAKING CHANGES

* **node:** requires Node.js >= 22.12. Node 14/16/18/20 are no longer supported.
* **esm:** the package is ESM-only (`"type": "module"`) and ships an `exports` map.
  Deep imports such as `require('tumblr-tags/lib/src/parser')` no longer resolve.
* **api:** the default export is gone. `parseTumblrPosts` is replaced by `syncSnapshot`
  and `syncPosts`, which return data instead of writing files; `prepareTags` is replaced
  by `countTags`. Reading and writing files are separate functions.
* **cache:** the cache file became a documented snapshot with `"schema": 2`. Files written
  by 1.x are rejected with an explanatory error and are not converted — delete the file and
  let `ttags` crawl the blog once.
* **counts:** `tags.json` now counts posts per tag instead of tag occurrences, so a post
  carrying the same tag twice no longer counts twice.
* **config:** the config file is loaded as a module (`ttags.config.js|mjs|cjs|json`, or a
  `ttags` field in package.json) and the `transform` callback is gone — use `minCount`.
* **paths:** paths resolve against the current directory instead of the nearest parent
  package.json directory, and `--snapshot`/`--out` take a file path, not a directory.
* **cli:** `ttags` exits non-zero on failure (1 error, 2 usage, 3 incomplete, 4 auth,
  5 blog not found). Previously it always exited 0, even after a failed crawl. An
  interrupted run reports 3 as well, so a wrapper cannot mistake a preempted runner
  for a success.
* **cli:** arguments are parsed by `node:util parseArgs` instead of yargs.
* **deps:** dropped `tumblr.js`, `yargs`, `find-config` and `read-pkg-up`. The package has
  zero runtime dependencies and talks to the API over the built-in `fetch`.

### Features

* retries with exponential backoff for network errors, timeouts, 5xx and empty bodies
* rate limit awareness: 429 stops the run with exit code 3 instead of waiting out an
  hour-long window, and an exhausted daily quota is never retried
* per-run request budget (300 by default) that also counts retries, so several tools can
  share the 1000 requests/hour Tumblr allows per key
* crawl goes newest-first and stops at the first fully known page; offsets advance by the
  number of posts actually returned
* snapshot helpers that used to be written by hand downstream: `compactTags`, `unusedTags`,
  `postsByTag`, `postTags`, `upsertPost`, `removePosts`, `tagIndex`
* `ttags tags` rebuilds the tag file from the snapshot without touching the network
* progress is reported through `onProgress`; the library no longer prints anything
* atomic snapshot writes, so an interrupted run cannot leave truncated JSON
* posts keep newest-first order across incremental runs, and reading repairs a file
  written in the wrong order

### Bug Fixes

* do not dereference a null response after a rejected request — this was the
  `Cannot read properties of null` crash seen in production
* surface failures instead of logging them and resolving anyway
* use `id_string` for post ids: numeric ids exceed `Number.MAX_SAFE_INTEGER`
* drop duplicate tags a post may carry
* create nested output directories recursively
* never print the consumer key in logs or error messages
* fetch post ids sequentially instead of firing every request at once
* honour `maxRequests` and `pageSize` from the config file, not only from the flags
* ship `dist/cli.js` executable, so running it directly or installing from a local
  path works without a manual chmod
* keep the `bin` path in a form npm does not drop while publishing — the package
  would otherwise have shipped without its `ttags` command

### [1.0.3](https://github.com/romanyanke/tumblr-tags/compare/v1.0.2...v1.0.3) (2021-03-20)

### [1.0.2](https://github.com/romanyanke/tumblr-tags/compare/v1.0.1...v1.0.2) (2021-03-20)


### Bug Fixes

* Package bundle dependencies – 2 ([51bc3b6](https://github.com/romanyanke/tumblr-tags/commit/51bc3b6db7e1ec89eca075193bdad57504968e98))

### [1.0.1](https://github.com/romanyanke/tumblr-tags/compare/v1.0.0...v1.0.1) (2021-03-20)


### Bug Fixes

* Package bundle dependencies ([1aa10a6](https://github.com/romanyanke/tumblr-tags/commit/1aa10a6d6d996d61a178b7af71a8bb829ba2868e))

## 1.0.0 (2021-03-20)


### Features

* Init first version ([4129e72](https://github.com/romanyanke/daynight/commit/4129e725f0a1e5aa688c039fc178b3f1b8acb43c))
