/**
 * 播放期路径自愈：索引里的视频路径失效（文件被移动 / 整理过）时，按「文件名 + 字节数」
 * 在该资料库配置的媒体目录里把文件找回来。
 *
 * 契约：
 * - 只在**资料库里配置的那些目录**子树内查找（和扫描同源），不从磁盘或连接根开始遍历；
 * - 只认「文件名等价 + 字节数相同」，不做标题模糊匹配——宁可继续 404，也不能放错片子；
 * - 单个目录列不出来（没权限 / 断线 / 已删除）就跳过，不影响其它目录；
 * - 遍历有硬上限（条目数、深度），超限即放弃；
 * - 「找不到」的结论按「资料库 + 连接 + 文件名 + 字节数」缓存 60 秒，播放器反复重试
 *   同一个源时不会一遍遍遍历整个资料库。
 */
import { basenameRemotePath, dirnameRemotePath, type FileEntry } from '@common/types/file'
import type { FileClient } from '$/modules/file/FileClient'
import { getFileClient } from '$/modules/file/fileClientManager'
import { getLibrary } from '$/modules/library/libraryStore'

/** 单次查找最多检查多少个条目；超了直接放弃，避免大资料库上把起播拖死 */
const MAX_ENTRIES = 20_000
/** 目录递归深度上限 */
const MAX_DEPTH = 8
/** 「找不到」的结论缓存时长（毫秒） */
const MISS_TTL_MS = 60_000

/** 查不到的时间点，键是「资料库 + 连接 + 文件名 + 字节数」 */
const missedAt = new Map<string, number>()

export interface LocateMovedFileRequest {
  /** 连接 ID（也就是 `storage://` 地址里的存储 ID） */
  connectionId: string
  /** 资料库 ID：决定在哪些目录里找 */
  libraryId: string
  /** 索引里那条已经失效的路径，用来先在同目录快查一次 */
  path: string
  /** 期望的字节数；<= 0 时只按文件名匹配 */
  size: number
}

/** 文件名等价：忽略大小写与首尾空白（本地 / WebDAV / SMB 的大小写敏感性各不相同） */
function sameName(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

function sameSize(entry: FileEntry, size: number): boolean {
  return size <= 0 || entry.size === size
}

function isMatch(entry: FileEntry, name: string, size: number): boolean {
  return entry.type === 'file' && sameName(entry.name, name) && sameSize(entry, size)
}

/** 列目录失败一律当作没找到：自愈是尽力而为，不能因为一个坏目录中断播放 */
async function findInDir(
  client: FileClient,
  dirPath: string,
  name: string,
  size: number
): Promise<FileEntry | null> {
  try {
    const entries = await client.list(dirPath)
    return entries.find((entry) => isMatch(entry, name, size)) ?? null
  } catch {
    return null
  }
}

/** 资料库里属于这个连接的媒体目录；资料库不存在时返回空数组 */
function rootsOf(request: LocateMovedFileRequest): string[] {
  const library = getLibrary(request.libraryId)
  if (!library) return []
  const roots: string[] = []
  for (const item of library.paths) {
    if (item.connectionId !== request.connectionId) continue
    if (roots.includes(item.path)) continue
    roots.push(item.path)
  }
  return roots
}

/** 从资料库目录开始逐层找：广度优先，命中即返回 */
async function searchRoots(
  client: FileClient,
  roots: readonly string[],
  name: string,
  size: number
): Promise<FileEntry | null> {
  const visited = new Set<string>()
  const queue: { path: string; depth: number }[] = roots.map((path) => ({ path, depth: 0 }))
  let checked = 0
  for (let head = 0; head < queue.length && checked < MAX_ENTRIES; head += 1) {
    const current = queue[head]
    if (!current || visited.has(current.path)) continue
    visited.add(current.path)
    let entries: FileEntry[]
    try {
      entries = await client.list(current.path)
    } catch {
      continue
    }
    checked += entries.length
    for (const entry of entries) {
      if (isMatch(entry, name, size)) return entry
      if (entry.type === 'directory' && current.depth < MAX_DEPTH) {
        queue.push({ path: entry.path, depth: current.depth + 1 })
      }
    }
  }
  return null
}

/**
 * 按「文件名 + 字节数」找回被移动的视频；找不到返回 null。
 *
 * 先在同目录里快查一次（同目录改名 / 移进子目录最常见），再回到资料库目录逐层找。
 */
export async function locateMovedFile(request: LocateMovedFileRequest): Promise<FileEntry | null> {
  const name = basenameRemotePath(request.path)
  if (name.length === 0) return null

  const key = `${request.libraryId}\n${request.connectionId}\n${name.toLowerCase()}\n${request.size}`
  const missed = missedAt.get(key)
  const now = Date.now()
  if (missed !== undefined && now - missed < MISS_TTL_MS) return null

  const client = await getFileClient(request.connectionId)
  const nearby = await findInDir(client, dirnameRemotePath(request.path), name, request.size)
  if (nearby) {
    missedAt.delete(key)
    return nearby
  }

  const found = await searchRoots(client, rootsOf(request), name, request.size)
  if (found) missedAt.delete(key)
  else missedAt.set(key, now)
  return found
}
