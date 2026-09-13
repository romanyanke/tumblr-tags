import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../../src/config.js'
import { tempDir } from '../helpers/tmp-dir.js'

describe('loadConfig', () => {
  it('reads a config as an ES module', async () => {
    const dir = await tempDir()

    await writeFile(
      join(dir, 'ttags.config.mjs'),
      "export default { blog: 'my-blog', minCount: 2 }\n",
      'utf8',
    )

    expect(await loadConfig(undefined, dir)).toEqual({ blog: 'my-blog', minCount: 2 })
  })

  it('reads a module.exports config through .cjs', async () => {
    const dir = await tempDir()

    await writeFile(join(dir, 'ttags.config.cjs'), "module.exports = { blog: 'legacy' }\n", 'utf8')

    expect(await loadConfig(undefined, dir)).toEqual({ blog: 'legacy' })
  })

  it('reads JSON — a config need not be code', async () => {
    const dir = await tempDir()

    await writeFile(join(dir, 'ttags.config.json'), '{"blog":"json-blog","out":"o.json"}', 'utf8')

    expect(await loadConfig(undefined, dir)).toEqual({ blog: 'json-blog', out: 'o.json' })
  })

  it('honours an explicit path', async () => {
    const dir = await tempDir()

    await writeFile(join(dir, 'custom.json'), '{"blog":"explicit"}', 'utf8')

    expect(await loadConfig('custom.json', dir)).toEqual({ blog: 'explicit' })
  })

  it('reports a clear error for a missing explicit path', async () => {
    await expect(loadConfig('missing.json', await tempDir())).rejects.toThrow(ConfigError)
  })

  it('fails on a broken config instead of staying silent', async () => {
    const dir = await tempDir()

    await writeFile(join(dir, 'broken.json'), '{ not json', 'utf8')

    await expect(loadConfig('broken.json', dir)).rejects.toThrow(ConfigError)
  })

  it('reads the ttags field from package.json', async () => {
    const dir = await tempDir()

    await writeFile(
      join(dir, 'package.json'),
      '{"name":"x","ttags":{"blog":"from-package"}}',
      'utf8',
    )

    expect(await loadConfig(undefined, dir)).toEqual({ blog: 'from-package' })
  })

  it('returns an empty object when there is no config', async () => {
    expect(await loadConfig(undefined, await tempDir())).toEqual({})
  })

  it('never walks up the tree — that is how 1.x wrote into the parent directory', async () => {
    const parent = await tempDir()
    const child = join(parent, 'sub')

    await mkdir(child)
    await writeFile(join(parent, 'ttags.config.json'), '{"blog":"parent"}', 'utf8')

    expect(await loadConfig(undefined, child)).toEqual({})
  })

  it('ignores unrelated fields', async () => {
    const dir = await tempDir()

    await writeFile(
      join(dir, 'ttags.config.json'),
      '{"blog":"b","transform":"gone","minCount":"a string"}',
      'utf8',
    )

    expect(await loadConfig(undefined, dir)).toEqual({ blog: 'b' })
  })
})
