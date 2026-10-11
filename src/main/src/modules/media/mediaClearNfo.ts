/**
 * 「清除 NFO」：把一部影片退回「扫描过、还没刮」的状态 —— 数据清掉、文件改回原名、位置搬回去。
 *
 * 契约：
 * - **还原依据是 NFO 里的「刮削前位置」记录**（`<originalfilename>` / `<originaldirectory>` /
 *   `<plantedfile>`，由 `@common/types/scrape/nfo.ts` 写入、`parseNfoRestore` 读回）：
 *   视频改回原文件名、移回原目录；`localFirst` 沿用过的本地图片搬回原来的文件名与目录，
 *   联网下载的图片与预告片直接删掉；
 * - **绝不覆盖**：还原目标已经存在时保持现状（文件留在影片目录里），只报「没还原」，
 *   不删、不覆盖任何同名文件；
 * - **没有记录也要清**：旧版本刮削的 NFO 里没有记录，那种情况退化成原来的口径
 *   （只清库内数据 + 删 NFO），不影响本功能的可用性；
 * - **先磁盘、后数据库**：磁盘上的 NFO 删失败就整体失败、库内数据原样保留 —— 只清库不删盘，
 *   下次开「优先本地 NFO」重刮会把同一份错误数据再读回来；其余磁盘动作都是尽力而为，
 *   删不掉 / 搬不动只跳过，不让整次还原失败；
 * - **只动刮削产物**：NFO、记录里列出的图片与预告片、以及自己创建且搬空的影片目录；
 *   没记在 NFO 里的文件一律不碰；演员本人档案（`actor`）不动，只删该条目的参演名单；
 * - 只对影片条目生效：条目不存在、不是影片、没有媒体源都抛 `MediaError`。
 */
import {
  FILE_ROOT,
  basenameRemotePath,
  dirnameRemotePath,
  joinRemotePath,
  normalizeRemotePath
} from '@common/types/file'
import {
  MediaError,
  parseNfoRestore,
  type MediaClearNfoRequest,
  type MediaClearNfoResult,
  type NfoRestoreInfo
} from '@common/types/media'
import { extractKeyword, normalizeNum } from '@common/types/scrape'
import { deleteCastByItems } from '$/db/repo/actorRepo'
import { getLibrary } from '$/db/repo/libraryRepo'
import { deleteImagesByItem } from '$/db/repo/mediaImageRepo'
import { clearItemMetadata, getItem, listSourcesByItem } from '$/db/repo/mediaRepo'
import type { FileClient } from '$/modules/file/FileClient'
import { getFileClient } from '$/modules/file/fileClientManager'
import { nfoCandidates, primarySourceOf } from '$/modules/media/mediaWall'
import { refreshSourcePath } from '$/modules/scrape/scrapeJobApply'

/** 连接拿不到时的失败口径与删 NFO 失败一致：磁盘一步没做成，库里就不许动 */
async function openClient(connectionId: string): Promise<FileClient> {
  try {
    return await getFileClient(connectionId)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new MediaError('writeFailed', `连接不可用（${reason}），刮削数据保持不变`)
  }
}

/**
 * 读同目录 NFO 里的还原记录：按候选顺序（`movie.nfo` → `<视频基础名>.nfo`）读，
 * 第一条能用的就用 —— 同目录并存两份时，带记录的那份照样能被找到。
 */
async function readRestore(
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
async function removeNfoFiles(
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
async function existsOrTrue(client: FileClient, path: string): Promise<boolean> {
  try {
    return await client.exists(path)
  } catch {
    return true
  }
}

/** 搬文件（必要时补建父目录）；失败返回 false，由调用方决定怎么记账 */
async function moveFile(client: FileClient, from: string, to: string): Promise<boolean> {
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

/** 该影片所属资料库在本连接下的根目录，清理空目录时绝不误删 */
function libraryRoots(libraryId: string, connectionId: string): string[] {
  const library = getLibrary(libraryId)
  if (!library) return []
  return library.paths
    .filter((path) => path.connectionId === connectionId)
    .map((path) => normalizeRemotePath(path.path))
}

/**
 * 清除一部影片的 NFO 与刮削数据，并按 NFO 里的记录把文件还原成刮削前的样子。
 *
 * 步骤固定为「读记录 → 删 NFO → 还原 / 清理资源 → 搬回视频 → 写库 → 删空目录」：
 * 前两步失败时库里一切照旧，不会出现「数据清了、NFO 还在」的半成品状态。
 */
export async function clearMediaNfo(request: MediaClearNfoRequest): Promise<MediaClearNfoResult> {
  const itemId = request.itemId.trim()
  if (itemId.length === 0) throw new MediaError('invalidArgument', '缺少影片 ID')
  const item = getItem(itemId)
  if (!item || item.type !== 'movie') throw new MediaError('notFound', '索引里没有这部影片')
  const source = primarySourceOf(item, listSourcesByItem(itemId))
  if (!source) throw new MediaError('notFound', '这部影片没有可用的媒体源')

  const client = await openClient(source.connectionId)
  const dirPath = dirnameRemotePath(source.path)
  const names = nfoCandidates(source)
  const record = await readRestore(client, dirPath, names)
  const removedNfo = await removeNfoFiles(client, dirPath, names)

  // 刮削写下的资源：本地沿用过的搬回原处，联网下载的直接删；目标被占用就原样留着
  const deletePaths: string[] = []
  const restoredAssets: string[] = []
  for (const file of record?.files ?? []) {
    const planted = joinRemotePath(dirPath, file.relativePath)
    if (file.origin.length === 0) {
      deletePaths.push(planted)
      continue
    }
    if (normalizeRemotePath(file.origin) === normalizeRemotePath(planted)) continue
    if (await existsOrTrue(client, file.origin)) continue
    if (await moveFile(client, planted, file.origin)) restoredAssets.push(file.origin)
  }
  const removedAssets = await removeFiles(client, deletePaths)

  // 视频改回原名、移回原目录；记录里的目标已存在时保持现状（绝不覆盖）
  let finalPath = source.path
  let restored = false
  if (record) {
    const target = joinRemotePath(record.directory, record.fileName)
    if (normalizeRemotePath(target) === normalizeRemotePath(source.path)) {
      restored = true
    } else if (!(await existsOrTrue(client, target)) && (await moveFile(client, source.path, target))) {
      await refreshSourcePath(client, source.connectionId, itemId, source.path, target)
      finalPath = target
      restored = true
    }
  }

  // 还原口径与扫描一致：展示名 = 磁盘上的视频文件名（含扩展名），番号从该文件名解析
  const fileName = basenameRemotePath(finalPath)
  clearItemMetadata(itemId, { name: fileName, num: normalizeNum(extractKeyword(fileName).num) })
  deleteImagesByItem(itemId)
  deleteCastByItems([itemId])

  // 自己创建、现在已搬空的影片目录顺手删掉（资料库根目录与视频所在目录一律不删）
  let removedDir = ''
  const roots = libraryRoots(item.libraryId, source.connectionId)
  if (normalizeRemotePath(dirPath) !== normalizeRemotePath(dirnameRemotePath(finalPath))) {
    if (dirPath !== FILE_ROOT && !roots.includes(normalizeRemotePath(dirPath))) {
      try {
        const rest = await client.list(dirPath)
        if (rest.length === 0) {
          await client.remove(dirPath, { recursive: true })
          removedDir = dirPath
        }
      } catch {
        // 目录已经不在或删不掉：不影响已经完成的还原
      }
    }
  }

  return { itemId, removedNfo, removedAssets, restoredAssets, restored, path: finalPath, removedDir }
}
