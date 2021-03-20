# Tumblr tags

This tool parse all tags used in the posts of a Tumblr blog. You can use the tag information to make a tag cloud.

## Prerequisites

- Create a [Tumblr application](https://www.tumblr.com/oauth/apps).
- Obtain an OAuth consumer key

## Setup

```
npm install tumblr-tags --save-dev
```

In the root of your project create a configuration file `ttags.js` with content:

```
module.exports = {
  blog: '…',
  consumerKey: '…'
}
```

| Key               | Required | Defaults | Description                          |
| ----------------- | -------- | -------- | ------------------------------------ |
| `blog`            | yes      |          | Your tumblr blog name                |
| `consumerKey`     | yes      |          | API consumer key                     |
| `cachePath`       |          | `tmp`    | Cache folder path                    |
| `outPath`         |          | `dist`   | Dist folder with `tags.json`         |
| `transform(tags)` |          |          | Transform tags written to `outPath`. |

## Parse tags

There is a node script `./node_modules/.bin/ttags`. You can run it directly or add an npm npm script to package.json and run it `npm start`:

```
  "scripts": {
    "start": "ttags"
  }
```

It queries blog posts and save tag data to the cache directory. Cache has the following structure:

```
{
  tags: {
    <tag>: tag-index,
  },
  posts: {
    <post-id>: tag-index[]
  }
}
```

Cache is only for internal usage. A `tags.json` file is created/updated after every cache change. It's an output you are looking for and it has simple structire:

```
[
  { tag: "my tag", count: 1},
  { tag: "another tag", count: 4},
  …
]
```

When you call `ttags` script it will skip all the cached posts and it will look only for the new ones so you can run it periodically to update your tag information.

If you want to parse the whole blog again simply remove `source.json` file in the cache directory and run `ttags`

### Parse a single post

When a post is in the cache and you update its tags in tumblr it can useful to update the cache only for this post. You can pass a post id as an argument:

```
ttags post 139236866355 139236480280 […]
```

### Transform method

You can specify a `transform` method in the config file. It accepts all tags as an argument. This is a place you can filter of modify you tags. Let's remove all the tags that occur only once in the blog:

```
module.exports = {
  transform: tags => tags.filter(tag => tag.count > 1)
}

```
