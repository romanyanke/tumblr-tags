import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'

const created: string[] = []

afterEach(async () => {
  await Promise.all(created.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/** A temporary directory that removes itself after the test. */
export const tempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'ttags-'))

  created.push(dir)

  return dir
}
