import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { HELP } from '../../src/cli-args.js'
import * as api from '../../src/index.js'

const readme = await readFile(fileURLToPath(new URL('../../README.md', import.meta.url)), 'utf8')

describe('README', () => {
  it('lists only exports that exist', () => {
    const section = readme.slice(readme.indexOf('### Exports'), readme.indexOf('### Cancelling'))
    const mentioned = [...section.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)].map(match => match[1])
    const known = new Set(Object.keys(api))

    expect(mentioned.length).toBeGreaterThan(20)
    expect(mentioned.filter(name => name && !known.has(name))).toEqual([])
  })

  it('documents every command-line option', () => {
    const flags = [...HELP.matchAll(/(--[a-z-]+)/g)].map(match => match[1])

    expect(new Set(flags).size).toBeGreaterThan(10)

    for (const flag of new Set(flags)) {
      expect(readme, `${flag} is missing from the README`).toContain(flag as string)
    }
  })

  it('documents every exit code', async () => {
    const { EXIT } = await import('../../src/run.js')

    for (const code of Object.values(EXIT)) {
      expect(readme).toMatch(new RegExp(`\\|\\s*${code}\\s*\\|`))
    }
  })

  it('shows the current snapshot schema version', () => {
    expect(readme).toContain(`"schema": ${api.SNAPSHOT_SCHEMA_VERSION}`)
  })
})
