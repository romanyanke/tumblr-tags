import { countTotalRequests, getLimitOffset, normalizePathName } from '../src/utils'

describe('normalizePathName', () => {
  it('should return dir and filename', () => {
    expect(normalizePathName('./', 'file.json')).toEqual({
      dirname: '.',
      filename: 'file.json',
      path: 'file.json',
    })
    expect(normalizePathName('foo/bar/', 'file.json')).toEqual({
      dirname: 'foo/bar',
      filename: 'file.json',
      path: 'foo/bar/file.json',
    })
  })

  it('should use json file name from path', () => {
    expect(normalizePathName('./file.json', '')).toEqual({
      dirname: '.',
      filename: 'file.json',
      path: 'file.json',
    })
    expect(normalizePathName('foo/bar/file.json', '')).toEqual({
      dirname: 'foo/bar',
      filename: 'file.json',
      path: 'foo/bar/file.json',
    })
  })

  it('should use json file name from fallback', () => {
    expect(normalizePathName('bar', 'fallback.json')).toEqual({
      dirname: 'bar',
      filename: 'fallback.json',
      path: 'bar/fallback.json',
    })
    expect(normalizePathName('bar', 'fallback')).toEqual({
      dirname: 'bar',
      filename: 'fallback.json',
      path: 'bar/fallback.json',
    })
  })
})

describe('getLimitOffset', () => {
  it('no cache case', () => {
    expect(
      getLimitOffset({
        totalPosts: 5,
        limit: 2,
        iteration: 0,
        cachedPosts: 0,
      }),
    ).toEqual({ limit: 2, offset: 3 })

    expect(
      getLimitOffset({
        totalPosts: 5,
        limit: 2,
        iteration: 1,
        cachedPosts: 0,
      }),
    ).toEqual({ limit: 2, offset: 1 })

    expect(
      getLimitOffset({
        totalPosts: 5,
        limit: 2,
        iteration: 3,
        cachedPosts: 0,
      }),
    ).toEqual({ limit: 1, offset: 0 })
  })

  it('with cache case', () => {
    expect(
      getLimitOffset({
        totalPosts: 7,
        limit: 2,
        iteration: 0,
        cachedPosts: 2,
      }),
    ).toEqual({ limit: 2, offset: 3 })

    expect(
      getLimitOffset({
        totalPosts: 7,
        limit: 2,
        iteration: 1,
        cachedPosts: 2,
      }),
    ).toEqual({ limit: 2, offset: 1 })

    expect(
      getLimitOffset({
        totalPosts: 7,
        limit: 2,
        iteration: 2,
        cachedPosts: 2,
      }),
    ).toEqual({ limit: 1, offset: 0 })
  })

  describe('countTotalRequests', () => {
    it('should return number of requests', () => {
      expect(countTotalRequests({ totalPosts: 0, limit: 10 })).toBe(0)
      expect(countTotalRequests({ totalPosts: 5, limit: 10 })).toBe(1)
      expect(countTotalRequests({ totalPosts: 10, limit: 10 })).toBe(1)
      expect(countTotalRequests({ totalPosts: 15, limit: 10 })).toBe(2)
      expect(countTotalRequests({ totalPosts: 20, limit: 9 })).toBe(3)
    })
  })
})
