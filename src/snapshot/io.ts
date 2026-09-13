import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Snapshot, TagCount } from '../types.js'
import { parseSnapshot, serializeSnapshot } from './schema.js'

/**
 * Writes through a temporary file and a `rename`.
 *
 * An interrupted process physically cannot leave truncated JSON — that is what
 * the SIGINT handler inside the 1.x library was for.
 */
const writeAtomic = async (path: string, contents: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })

  const temp = `${path}.${process.pid}.tmp`

  await writeFile(temp, contents, 'utf8')
  await rename(temp, path)
}

export const readSnapshot = async (path: string): Promise<Snapshot> =>
  parseSnapshot(await readFile(path, 'utf8'))

/** Reads the snapshot when the file exists. A missing file is fine; a corrupt one is not. */
export const readSnapshotIfExists = async (path: string): Promise<Snapshot | null> => {
  try {
    return await readSnapshot(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }

    throw error
  }
}

export const writeSnapshot = async (path: string, snapshot: Snapshot): Promise<void> => {
  await writeAtomic(path, serializeSnapshot(snapshot))
}

export const writeTagCounts = async (path: string, counts: readonly TagCount[]): Promise<void> => {
  await writeAtomic(path, JSON.stringify(counts))
}
