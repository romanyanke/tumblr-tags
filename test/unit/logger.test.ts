import { describe, expect, it, vi } from 'vitest'
import { createLogger } from '../../src/logger.js'

const fakeStream = (isTTY = false) => {
  const written: string[] = []
  const stream = {
    isTTY,
    write: (chunk: string) => {
      written.push(chunk)

      return true
    },
  } as unknown as NodeJS.WriteStream

  return { stream, written, text: () => written.join('') }
}

describe('createLogger', () => {
  it('обычный уровень печатает info, но не detail', () => {
    const { stream, text } = fakeStream()
    const logger = createLogger({ stream })

    logger.info('видно')
    logger.detail('не видно')

    expect(text()).toContain('видно')
    expect(text()).not.toContain('не видно')
  })

  it('подробный уровень печатает и detail', () => {
    const { stream, text } = fakeStream()

    createLogger({ level: 'verbose', stream }).detail('подробность')

    expect(text()).toContain('подробность')
  })

  it('тихий уровень молчит обо всём, кроме ошибок', () => {
    const { stream, text } = fakeStream()
    const logger = createLogger({ level: 'quiet', stream })

    logger.info('нет')
    logger.progress('нет')
    logger.error('да')

    expect(text()).toBe('да\n')
  })

  it('строка прогресса живёт только в терминале', () => {
    const plain = fakeStream(false)
    const tty = fakeStream(true)

    createLogger({ stream: plain.stream }).progress('идёт')
    createLogger({ stream: tty.stream }).progress('идёт')

    expect(plain.text()).toBe('')
    expect(tty.text()).toBe('\rидёт')
  })

  it('закрывает строку прогресса переводом строки', () => {
    const { stream, text } = fakeStream(true)
    const logger = createLogger({ stream })

    logger.progress('идёт')
    logger.endProgress()
    logger.endProgress()

    expect(text()).toBe('\rидёт\n')
  })

  it('не смешивает сообщение с недописанной строкой прогресса', () => {
    const { stream, text } = fakeStream(true)
    const logger = createLogger({ stream })

    logger.progress('идёт')
    logger.info('готово')

    expect(text()).toBe('\rидёт\nготово\n')
  })

  it('в режиме json пишет события построчно и молчит в остальном', () => {
    const { stream, text } = fakeStream()
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const logger = createLogger({ json: true, stream })

    logger.info('не сюда')
    logger.event('done', { posts: 3 })

    expect(text()).toBe('')
    expect(spy).toHaveBeenCalledWith('{"event":"done","posts":3}')

    spy.mockRestore()
  })

  it('без json события никуда не идут', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    createLogger({ stream: fakeStream().stream }).event('done', {})

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
