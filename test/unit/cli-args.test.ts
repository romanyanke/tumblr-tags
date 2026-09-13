import { describe, expect, it } from 'vitest'
import { parseCliArgs, UsageError } from '../../src/cli-args.js'

describe('parseCliArgs', () => {
  it('defaults to sync with no arguments', () => {
    const command = parseCliArgs([])

    expect(command.name).toBe('sync')
    expect(command.options.full).toBe(false)
    expect(command.options.writeTags).toBe(true)
    expect(command.options.level).toBe('normal')
  })

  it('recognises the commands', () => {
    expect(parseCliArgs(['sync']).name).toBe('sync')
    expect(parseCliArgs(['tags']).name).toBe('tags')
    expect(parseCliArgs(['--help']).name).toBe('help')
    expect(parseCliArgs(['-h']).name).toBe('help')
    expect(parseCliArgs(['--version']).name).toBe('version')
  })

  it('collects post ids', () => {
    expect(parseCliArgs(['post', '139236866355', '139236480280']).postIds).toEqual([
      '139236866355',
      '139236480280',
    ])
  })

  it('keeps ids as strings — long ones lose precision as numbers', () => {
    const id = '781234567890123456'

    expect(parseCliArgs(['post', id]).postIds[0]).toBe(id)
  })

  it('post without ids is a usage error', () => {
    expect(() => parseCliArgs(['post'])).toThrow(UsageError)
  })

  it('a non-numeric id is a usage error', () => {
    expect(() => parseCliArgs(['post', 'abc'])).toThrow(/digits only/)
  })

  it('an unknown command is a usage error', () => {
    expect(() => parseCliArgs(['whatever'])).toThrow(/Unknown command/)
  })

  it('an unknown flag is a usage error, not a stack trace', () => {
    expect(() => parseCliArgs(['--no-such-flag'])).toThrow(UsageError)
  })

  it('parses paths and numbers', () => {
    const { options } = parseCliArgs([
      '--config',
      'my.json',
      '--blog',
      'my-blog',
      '--snapshot',
      'tmp/s.json',
      '--out',
      'dist/t.json',
      '--min-count',
      '2',
      '--max-requests',
      '120',
      '--page-size',
      '50',
      '--timeout',
      '9000',
      '--retries',
      '3',
    ])

    expect(options).toMatchObject({
      config: 'my.json',
      blog: 'my-blog',
      snapshot: 'tmp/s.json',
      out: 'dist/t.json',
      minCount: 2,
      maxRequests: 120,
      pageSize: 50,
      timeout: 9000,
      retries: 3,
    })
  })

  it('supports the short -c form', () => {
    expect(parseCliArgs(['-c', 'x.json']).options.config).toBe('x.json')
  })

  it('a non-numeric value for a numeric option is a usage error', () => {
    expect(() => parseCliArgs(['--min-count', 'two'])).toThrow(/non-negative number/)
    expect(() => parseCliArgs(['--max-requests', '-5'])).toThrow(UsageError)
  })

  it('parses the boolean flags', () => {
    const { options } = parseCliArgs(['--full', '--compact', '--dry-run', '--no-tags', '--json'])

    expect(options).toMatchObject({
      full: true,
      compact: true,
      dryRun: true,
      json: true,
      writeTags: false,
    })
  })

  it('picks the output level', () => {
    expect(parseCliArgs(['-q']).options.level).toBe('quiet')
    expect(parseCliArgs(['--verbose']).options.level).toBe('verbose')
  })
})
