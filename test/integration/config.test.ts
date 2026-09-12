import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../../src/config.js'
import { tempDir } from '../helpers/tmp-dir.js'

describe('loadConfig', () => {
  it('читает конфиг как ES-модуль', async () => {
    const dir = await tempDir()

    await writeFile(
      join(dir, 'ttags.config.mjs'),
      "export default { blog: 'me-yanke', minCount: 2 }\n",
      'utf8',
    )

    expect(await loadConfig(undefined, dir)).toEqual({ blog: 'me-yanke', minCount: 2 })
  })

  it('читает конфиг с module.exports через .cjs', async () => {
    const dir = await tempDir()

    await writeFile(join(dir, 'ttags.config.cjs'), "module.exports = { blog: 'старый' }\n", 'utf8')

    expect(await loadConfig(undefined, dir)).toEqual({ blog: 'старый' })
  })

  it('читает JSON — конфиг не обязан быть кодом', async () => {
    const dir = await tempDir()

    await writeFile(join(dir, 'ttags.config.json'), '{"blog":"json-blog","out":"o.json"}', 'utf8')

    expect(await loadConfig(undefined, dir)).toEqual({ blog: 'json-blog', out: 'o.json' })
  })

  it('берёт явно указанный путь', async () => {
    const dir = await tempDir()

    await writeFile(join(dir, 'custom.json'), '{"blog":"явный"}', 'utf8')

    expect(await loadConfig('custom.json', dir)).toEqual({ blog: 'явный' })
  })

  it('явный отсутствующий путь — внятная ошибка', async () => {
    await expect(loadConfig('нет.json', await tempDir())).rejects.toThrow(ConfigError)
  })

  it('падает на сломанном конфиге, а не молчит', async () => {
    const dir = await tempDir()

    await writeFile(join(dir, 'broken.json'), '{ не json', 'utf8')

    await expect(loadConfig('broken.json', dir)).rejects.toThrow(ConfigError)
  })

  it('читает поле ttags из package.json', async () => {
    const dir = await tempDir()

    await writeFile(join(dir, 'package.json'), '{"name":"x","ttags":{"blog":"из пакета"}}', 'utf8')

    expect(await loadConfig(undefined, dir)).toEqual({ blog: 'из пакета' })
  })

  it('без конфига отдаёт пустой объект', async () => {
    expect(await loadConfig(undefined, await tempDir())).toEqual({})
  })

  it('не поднимается вверх по дереву — в 1.x из-за этого писали в родительский каталог', async () => {
    const parent = await tempDir()
    const child = join(parent, 'sub')

    await mkdir(child)
    await writeFile(join(parent, 'ttags.config.json'), '{"blog":"родитель"}', 'utf8')

    expect(await loadConfig(undefined, child)).toEqual({})
  })

  it('игнорирует посторонние поля', async () => {
    const dir = await tempDir()

    await writeFile(
      join(dir, 'ttags.config.json'),
      '{"blog":"b","transform":"нет такого","minCount":"строка"}',
      'utf8',
    )

    expect(await loadConfig(undefined, dir)).toEqual({ blog: 'b' })
  })
})
