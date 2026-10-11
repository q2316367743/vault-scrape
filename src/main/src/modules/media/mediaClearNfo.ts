/**
 * 「清除 NFO」：把一部影片 / 一整部剧集退回「扫描过、还没刮」的状态 —— 数据清掉、文件改回原名、位置搬回去。
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
 * - **只动刮削产物**：NFO、记录里列出的图片与预告片、以及自己创建且搬空的目录；
 *   没记在 NFO 里的文件一律不碰；演员本人档案（`actor`）不动，只删该条目的参演名单；
 * - 按条目类型分派：影片走 `clearMovieNfo`，剧集走 `clearSeriesNfo`（`mediaClearSeriesNfo.ts`），
 *   其余类型（季 / 集 / 目录）抛 `MediaError`。
 */
import {
  basenameRemotePath,
  dirnameRemotePath,
  joinRemotePath,
  normalizeRemotePath
} from '@common/types/file'
import {
  MediaError,
  type MediaClearNfoRequest,
  type MediaClearNfoResult
} from '@common/types/media'
import { extractKeyword, normalizeNum } from '@common/types/scrape'
import { deleteCastByItems } from '$/db/repo/actorRepo'
import { deleteImagesByItem } from '$/db/repo/mediaImageRepo'
import { clearItemMetadata, getItem, listSourcesByItem } from '$/db/repo/mediaRepo'
import type { MediaItemRow } from '$/db/schema/mediaItem'
import { nfoCandidates, primarySourceOf } from '$/modules/media/mediaWall'
import { refreshSourcePath } from '$/modules/scrape/scrapeJobApply'
import { clearSeriesNfo } from './mediaClearSeriesNfo'
import {
  existsOrTrue,
  libraryRoots,
  moveFile,
  openClient,
  readRestore,
  removeEmptyDir,
  removeNfoFiles,
  restorePlantedFiles
} from './mediaClearShared'

/**
 * 清除一个条目的 NFO 与刮削数据：条目不存在、类型不支持都抛 `MediaError`。
 */
export async function clearMediaNfo(request: MediaClearNfoRequest): Promise<MediaClearNfoResult> {
  const itemId = request.itemId.trim()
  if (itemId.length === 0) throw new MediaError('invalidArgument', '缺少条目 ID')
  const item = getItem(itemId)
  if (!item) throw new MediaError('notFound', '索引里没有这个条目')
  if (item.type === 'series') return clearSeriesNfo(item)
  if (item.type !== 'movie') throw new MediaError('notFound', '索引里没有这部影片')
  return clearMovieNfo(item)
}

/**
 * 清除一部影片的 NFO 与刮削数据，并按 NFO 里的记录把文件还原成刮削前的样子。
 *
 * 步骤固定为「读记录 → 删 NFO → 还原 / 清理资源 → 搬回视频 → 写库 → 删空目录」：
 * 前两步失败时库里一切照旧，不会出现「数据清了、NFO 还在」的半成品状态。
 */
async function clearMovieNfo(item: MediaItemRow): Promise<MediaClearNfoResult> {
  const itemId = item.id
  const source = primarySourceOf(item, listSourcesByItem(itemId))
  if (!source) throw new MediaError('notFound', '这部影片没有可用的媒体源')

  const client = await openClient(source.connectionId)
  const dirPath = dirnameRemotePath(source.path)
  const names = nfoCandidates(source)
  const record = await readRestore(client, dirPath, names)
  const removedNfo = await removeNfoFiles(client, dirPath, names)

  // 刮削写下的资源：本地沿用过的搬回原处，联网下载的直接删；目标被占用就原样留着
  const planted = await restorePlantedFiles(client, dirPath, record?.files ?? [])

  // 视频改回原名、移回原目录；记录里的目标已存在时保持现状（绝不覆盖）
  let finalPath = source.path
  let restored = false
  if (record) {
    const target = joinRemotePath(record.directory, record.fileName)
    if (normalizeRemotePath(target) === normalizeRemotePath(source.path)) {
      restored = true
    } else if (
      !(await existsOrTrue(client, target)) &&
      (await moveFile(client, source.path, target))
    ) {
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
  const removedDirs: string[] = []
  const roots = libraryRoots(item.libraryId, source.connectionId)
  if (normalizeRemotePath(dirPath) !== normalizeRemotePath(dirnameRemotePath(finalPath))) {
    const removed = await removeEmptyDir(client, dirPath, roots)
    if (removed.length > 0) removedDirs.push(removed)
  }

  return {
    itemId,
    removedNfo,
    removedAssets: planted.removed,
    restoredAssets: planted.restored,
    restored,
    path: finalPath,
    removedDirs
  }
}
