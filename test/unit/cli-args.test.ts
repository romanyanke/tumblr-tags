import { describe, expect, it } from 'vitest'
import { parseCliArgs, UsageError } from '../../src/cli-args.js'

describe('parseCliArgs', () => {
  it('без аргументов — синхронизация', () => {
    const command = parseCliArgs([])

    expect(command.name).toBe('sync')
    expect(command.options.full).toBe(false)
    expect(command.options.writeTags).toBe(true)
    expect(command.options.level).toBe('normal')
  })

  it('понимает команды', () => {
    expect(parseCliArgs(['sync']).name).toBe('sync')
    expect(parseCliArgs(['tags']).name).toBe('tags')
    expect(parseCliArgs(['--help']).name).toBe('help')
    expect(parseCliArgs(['-h']).name).toBe('help')
    expect(parseCliArgs(['--version']).name).toBe('version')
  })

  it('собирает идентификаторы постов', () => {
    expect(parseCliArgs(['post', '139236866355', '139236480280']).postIds).toEqual([
      '139236866355',
      '139236480280',
    ])
  })

  it('держит идентификаторы строками — числом длинные теряют точность', () => {
    const id = '781234567890123456'

    expect(parseCliArgs(['post', id]).postIds[0]).toBe(id)
  })

  it('post без идентификаторов — ошибка использования', () => {
    expect(() => parseCliArgs(['post'])).toThrow(UsageError)
  })

  it('нечисловой идентификатор — ошибка использования', () => {
    expect(() => parseCliArgs(['post', 'abc'])).toThrow(/цифр/)
  })

  it('неизвестная команда — ошибка использования', () => {
    expect(() => parseCliArgs(['нечто'])).toThrow(/Неизвестная команда/)
  })

  it('неизвестный флаг — ошибка использования, а не стектрейс', () => {
    expect(() => parseCliArgs(['--нет-такого'])).toThrow(UsageError)
  })

  it('разбирает пути и числа', () => {
    const { options } = parseCliArgs([
      '--config',
      'my.json',
      '--blog',
      'me-yanke',
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
      blog: 'me-yanke',
      snapshot: 'tmp/s.json',
      out: 'dist/t.json',
      minCount: 2,
      maxRequests: 120,
      pageSize: 50,
      timeout: 9000,
      retries: 3,
    })
  })

  it('короткая форма -c работает', () => {
    expect(parseCliArgs(['-c', 'x.json']).options.config).toBe('x.json')
  })

  it('нечисловое значение числовой опции — ошибка использования', () => {
    expect(() => parseCliArgs(['--min-count', 'два'])).toThrow(/неотрицательное число/)
    expect(() => parseCliArgs(['--max-requests', '-5'])).toThrow(UsageError)
  })

  it('разбирает флаги', () => {
    const { options } = parseCliArgs(['--full', '--compact', '--dry-run', '--no-tags', '--json'])

    expect(options).toMatchObject({
      full: true,
      compact: true,
      dryRun: true,
      json: true,
      writeTags: false,
    })
  })

  it('уровень вывода', () => {
    expect(parseCliArgs(['-q']).options.level).toBe('quiet')
    expect(parseCliArgs(['--verbose']).options.level).toBe('verbose')
  })
})
