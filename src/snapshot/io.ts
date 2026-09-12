import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Snapshot, TagCount } from '../types.js'
import { parseSnapshot, serializeSnapshot } from './schema.js'

/**
 * Запись через временный файл и `rename`.
 *
 * Прерванный процесс физически не может оставить обрезанный JSON — ради этого
 * в 1.x внутри библиотеки висел обработчик SIGINT.
 */
const writeAtomic = async (path: string, contents: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })

  const temp = `${path}.${process.pid}.tmp`

  await writeFile(temp, contents, 'utf8')
  await rename(temp, path)
}

export const readSnapshot = async (path: string): Promise<Snapshot> =>
  parseSnapshot(await readFile(path, 'utf8'))

/** Читает снапшот, если файл есть. Отсутствие файла — не ошибка, повреждение — ошибка. */
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
