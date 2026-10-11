/**
 * 「清除 NFO」的公共件：影片还原与剧集还原共用这批磁盘操作与记账规则。
 *
 * 契约（完整口径见 `mediaClearNfo`）：
 * - **先磁盘、后数据库**：NFO 删不掉属于致命失败，抛 `writeFailed`，调用方必须在此之后才动库内数据；
 * - **绝不覆盖**：还原目标已经存在时保持现状，只报「没还原」，不删不覆盖任何同名文件；
 * - **其余动作尽力而为**：搬不动 / 删不掉只跳过，不让整次还原失败；
 * - 只碰 NFO 记录里列出的文件与已经搬空的自建目录，没记在记录里的一律不动。
 */
import {
  FILE_ROOT,
  dirnameRemotePath,
  joinRemotePath,
  normalizeRemotePath
} from '@common/types/file'
import {
  MediaError,
  parseNfoRestore,
  type NfoRestoreFile,
  type NfoRestoreInfo
} from '@common/types/media'
import { getLibrary } from '$/db/repo/libraryRepo'
import type { FileClient } from '$/modules/file/FileClient'
import { getFileClient } from '$/modules/file/fileClientManager'

/** 剧集根 / 季目录的 NFO 固定名，与写入侧（`scrapeSeriesJob`）一致 */
export const SERIES_NFO_NAME = 'tvshow.nfo'
export const SEASON_NFO_NAME = 'season.nfo'

/** 一次资源还原的记账：删掉了哪些联网产物、搬回了哪些本地文件 */
export interface PlantedRestore {
  removed: string[]
  restored: string[]
}

/** 连接拿不到时的失败口径与删 NFO 失败一致：磁盘一步没做成，库里就不许动 */
export async function openClient(connectionId: string): Promise<FileClient> {
  try {
    return await getFileClient(connectionId)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new MediaError('writeFailed', `连接不可用（${reason}），刮削数据保持不变`)
  }
}

/**
 * 读同目录 NFO 里的还原记录：按候选顺序（影片是 `movie.nfo` → `<视频基础名>.nfo`，
 * 剧集是固定名）读，第一条能用的就用 —— 同目录并存两份时，带记录的那份照样能被找到。
 */
export async function readRestore(
  client: FileClient,
  dirPath: string,
  names: readonly string[]
): Promise<NfoRestoreInfo | null> {
  for (const name of names) {
    const path = joinRemotePath(dirPath, name)
    try {
      if (!(await client.exists(path))) continue
      const record = parseNfoRestore(await client.readText(path))
      if (record) return record
    } catch {
      // 单个候选读不出来就继续看下一个；都没有记录就退化成「只清数据」
    }
  }
  return null
}

/** 删掉同目录里存在的 NFO，返回真的删掉的那些路径；删不掉直接抛 `writeFailed` */
export async function removeNfoFiles(
  client: FileClient,
  dirPath: string,
  names: readonly string[]
): Promise<string[]> {
  const removed: string[] = []
  try {
    for (const name of names) {
      const target = joinRemotePath(dirPath, name)
      if (!(await client.exists(target))) continue
      await client.remove(target)
      removed.push(target)
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new MediaError('writeFailed', `磁盘上的 NFO 没有删除（${reason}），刮削数据保持不变`)
  }
  return removed
}

/** 存在判断：查询本身失败（离线 / 无权限）时当作「存在」，宁可不动文件也不覆盖同名文件 */
export async function existsOrTrue(client: FileClient, path: string): Promise<boolean> {
  try {
    return await client.exists(path)
  } catch {
    return true
  }
}

/** 搬文件（必要时补建父目录）；失败返回 false，由调用方决定怎么记账 */
export async function moveFile(client: FileClient, from: string, to: string): Promise<boolean> {
  if (from === to) return false
  try {
    const parent = dirnameRemotePath(to)
    if (parent !== FILE_ROOT) await client.mkdir(parent, { recursive: true })
    await client.move(from, to, { overwrite: false })
    return true
  } catch {
    return false
  }
}

/** 删掉刮削写下的文件，返回真的删掉的那些路径；删不掉的跳过（NFO 已删，这里只是清残留） */
async function removeFiles(client: FileClient, paths: readonly string[]): Promise<string[]> {
  const removed: string[] = []
  for (const path of paths) {
    try {
      if (!(await client.exists(path))) continue
      await client.remove(path)
      removed.push(path)
    } catch {
      // 尽力清理：删不掉不影响库内数据已经清干净
    }
  }
  return removed
}

/**
 * 处理一条还原记录里的刮削产物：本地沿用过的搬回原处，联网下载的直接删。
 * 目标已被占用或搬不动时原样留在原地，由调用方统一报「没还原」。
 */
export async function restorePlantedFiles(
  client: FileClient,
  dirPath: string,
  files: readonly NfoRestoreFile[]
): Promise<PlantedRestore> {
  const remove: string[] = []
  const restored: string[] = []
  for (const file of files) {
    const planted = joinRemotePath(dirPath, file.relativePath)
    if (file.origin.length === 0) {
      remove.push(planted)
      continue
    }
    if (normalizeRemotePath(file.origin) === normalizeRemotePath(planted)) continue
    if (await existsOrTrue(client, file.origin)) continue
    if (await moveFile(client, planted, file.origin)) restored.push(file.origin)
  }
  return { removed: await removeFiles(client, remove), restored }
}

/** 该资料库在本连接下的根目录，清理空目录时绝不误删 */
export function libraryRoots(libraryId: string, connectionId: string): string[] {
  const library = getLibrary(libraryId)
  if (!library) return []
  return library.paths
    .filter((path) => path.connectionId === connectionId)
    .map((path) => normalizeRemotePath(path.path))
}

/**
 * 把搬空的自建目录顺手删掉（`/` 与 `keep` 里的目录一律不删，`keep` 传资料库根）。
 * 返回被删掉的路径，没删时为空串。
 */
export async function removeEmptyDir(
  client: FileClient,
  dirPath: string,
  keep: readonly string[]
): Promise<string> {
  if (dirPath === FILE_ROOT || keep.includes(normalizeRemotePath(dirPath))) return ''
  try {
    const rest = await client.list(dirPath)
    if (rest.length > 0) return ''
    await client.remove(dirPath, { recursive: true })
    return dirPath
  } catch {
    // 目录已经不在或删不掉：不影响已经完成的还原
    return ''
  }
}
