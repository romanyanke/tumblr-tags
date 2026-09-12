import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { HELP } from '../../src/cli-args.js'
import * as api from '../../src/index.js'

const readme = await readFile(fileURLToPath(new URL('../../README.md', import.meta.url)), 'utf8')

describe('README', () => {
  it('перечисляет только существующие экспорты', () => {
    const section = readme.slice(readme.indexOf('### Exports'), readme.indexOf('### Cancelling'))
    const mentioned = [...section.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)].map(match => match[1])
    const known = new Set(Object.keys(api))

    expect(mentioned.length).toBeGreaterThan(20)
    expect(mentioned.filter(name => name && !known.has(name))).toEqual([])
  })

  it('описывает каждую опцию командной строки', () => {
    const flags = [...HELP.matchAll(/(--[a-z-]+)/g)].map(match => match[1])

    expect(new Set(flags).size).toBeGreaterThan(10)

    for (const flag of new Set(flags)) {
      expect(readme, `в README нет ${flag}`).toContain(flag as string)
    }
  })

  it('описывает каждый код выхода', async () => {
    const { EXIT } = await import('../../src/run.js')

    for (const code of Object.values(EXIT)) {
      expect(readme).toMatch(new RegExp(`\\|\\s*${code}\\s*\\|`))
    }
  })

  it('показывает актуальную версию схемы снапшота', () => {
    expect(readme).toContain(`"schema": ${api.SNAPSHOT_SCHEMA_VERSION}`)
  })
})
