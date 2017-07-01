import path from 'path'
import fs from 'fs'
import readPkgUp from 'read-pkg-up'
import { LimitOffsetPayload, CountRequestPayload } from './interface'

const upPackagePath = readPkgUp.sync()?.path
export const getParentModuleDir = () => {
  if (!upPackagePath) {
    throw new Error('parent module not found')
  }

  return path.parse(upPackagePath).dir
}

export const readSafeJSON = <T extends {}>(path: string, fallback: T = {} as T): T =>
  fs.existsSync(path) ? require(path) : fallback

export const normalizePathName = (pathname: string, fileNameFallback: string) => {
  const { ext, dir, base } = path.parse(pathname)
  const jsonExt = '.json'
  const isJSON = ext === jsonExt
  const filename = isJSON ? base : path.parse(fileNameFallback).name + jsonExt
  const dirname = isJSON ? dir : path.join(dir, base)

  return { dirname, filename, path: path.join(dirname, filename) }
}

export const getLimitOffset = ({
  iteration,
  cachedPosts,
  limit,
  totalPosts,
}: LimitOffsetPayload) => {
  const offset = totalPosts - limit * (iteration + 1) - cachedPosts

  if (offset < 0) {
    return {
      limit: Math.abs(limit + offset),
      offset: 0,
    }
  }

  return {
    limit,
    offset,
  }
}

export const countTotalRequests = ({ limit, totalPosts }: CountRequestPayload) => {
  return Math.ceil(totalPosts / limit)
}
