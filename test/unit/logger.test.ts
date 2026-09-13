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
  it('the normal level prints info but not detail', () => {
    const { stream, text } = fakeStream()
    const logger = createLogger({ stream })

    logger.info('visible')
    logger.detail('hidden')

    expect(text()).toContain('visible')
    expect(text()).not.toContain('hidden')
  })

  it('the verbose level prints detail too', () => {
    const { stream, text } = fakeStream()

    createLogger({ level: 'verbose', stream }).detail('a detail')

    expect(text()).toContain('a detail')
  })

  it('the quiet level says nothing but errors', () => {
    const { stream, text } = fakeStream()
    const logger = createLogger({ level: 'quiet', stream })

    logger.info('no')
    logger.progress('no')
    logger.error('yes')

    expect(text()).toBe('yes\n')
  })

  it('the progress line exists only in a terminal', () => {
    const plain = fakeStream(false)
    const tty = fakeStream(true)

    createLogger({ stream: plain.stream }).progress('working')
    createLogger({ stream: tty.stream }).progress('working')

    expect(plain.text()).toBe('')
    expect(tty.text()).toBe('\rworking')
  })

  it('closes the progress line with a newline', () => {
    const { stream, text } = fakeStream(true)
    const logger = createLogger({ stream })

    logger.progress('working')
    logger.endProgress()
    logger.endProgress()

    expect(text()).toBe('\rworking\n')
  })

  it('does not mix a message into an unfinished progress line', () => {
    const { stream, text } = fakeStream(true)
    const logger = createLogger({ stream })

    logger.progress('working')
    logger.info('done')

    expect(text()).toBe('\rworking\ndone\n')
  })

  it('in json mode it emits events line by line and stays quiet otherwise', () => {
    const { stream, text } = fakeStream()
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const logger = createLogger({ json: true, stream })

    logger.info('not here')
    logger.event('done', { posts: 3 })

    expect(text()).toBe('')
    expect(spy).toHaveBeenCalledWith('{"event":"done","posts":3}')

    spy.mockRestore()
  })

  it('without json, events go nowhere', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    createLogger({ stream: fakeStream().stream }).event('done', {})

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
