/**
 * 剧集版「清除 NFO」：把一整部剧退回「扫描过、还没刮」的状态。
 *
 * 契约：
 * - 还原依据是三层 NFO 里的记录：剧集根 `tvshow.nfo`（原剧集目录的父目录 + 目录名）、
 *   季 `season.nfo`、每集 NFO（原集文件名 + 原目录）；
 * - **剧集目录会按记录改名回原位**，改名前先 `replacePathPrefix` 一次改写条目 / 媒体源 /
 *   图片的路径前缀 —— 集 NFO 里记的「旧剧集目录下的季目录」随即重新成立，
 *   搬回去的集文件会自动把旧季目录建出来；
 * - **季目录名不回改**（刮削时的规范化改名没有留下原始名）：旧季目录由集文件搬回时重建，
 *   规范化后的季目录在搬空之后按空目录删掉；
 * - 库内只清刮削数据：剧集 / 季 / 集的标题、图片、参演名单；条目本身与父子关系都不动，
 *   下一次扫描再按磁盘结构校正（旧季目录对应的新季条目由扫描建立）；
 * - NFO 删失败（第一步）直接整体失败，库内数据原样保留；
 * - 只对 `type === 'series'` 的条目生效，调用方负责判类型。
 */
import {
  basenameRemotePath,
  dirnameRemotePath,
  joinRemotePath,
  normalizeRemotePath
} from '@common/types/file'
import { type MediaClearNfoResult } from '@common/types/media'
import { extractKeyword, normalizeNum, stripExtension } from '@common/types/scrape'
import { deleteCastByItems } from '$/db/repo/actorRepo'
import { deleteImagesByItem } from '$/db/repo/mediaImageRepo'
import { clearItemMetadata, listSourcesByItem } from '$/db/repo/mediaRepo'
import { listEpisodeItems, listSeasonItems, replacePathPrefix } from '$/db/repo/mediaSeriesRepo'
import type { MediaItemRow } from '$/db/schema/mediaItem'
import { primarySourceOf } from '$/modules/media/mediaWall'
import { nfoFileName } from '$/modules/scrape/scrapeLayout'
import { refreshSourcePath } from '$/modules/scrape/scrapeJobApply'
import {
  SEASON_NFO_NAME,
  SERIES_NFO_NAME,
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
 * 清除一整部剧集的 NFO 与刮削数据，并按三层 NFO 的记录把文件还原成刮削前的样子。
 *
 * 顺序固定为「剧集根 → 逐季 → 逐集」，每层都是「读记录 → 删 NFO → 还原资源 → 搬回文件」，
 * 剧集根的改名必须排在最前面，否则集 NFO 里记的旧目录名不成立。
 */
export async function clearSeriesNfo(item: MediaItemRow): Promise<MediaClearNfoResult> {
  const itemId = item.id
  const libraryId = item.libraryId
  const client = await openClient(item.connectionId)

  const removedNfo: string[] = []
  const removedAssets: string[] = []
  const restoredAssets: string[] = []
  const removedDirs: string[] = []
  let restored = false

  // 1. 剧集根：先读记录、删 NFO，再按记录把剧集目录名改回去（整树前缀一次改写）
  let seriesDir = item.path
  const seriesRecord = await readRestore(client, seriesDir, [SERIES_NFO_NAME])
  removedNfo.push(...(await removeNfoFiles(client, seriesDir, [SERIES_NFO_NAME])))
  if (seriesRecord) {
    const target = joinRemotePath(seriesRecord.directory, seriesRecord.fileName)
    if (normalizeRemotePath(target) === normalizeRemotePath(seriesDir)) {
      restored = true
    } else if (
      !(await existsOrTrue(client, target)) &&
      (await moveFile(client, seriesDir, target))
    ) {
      replacePathPrefix(libraryId, seriesDir, target)
      seriesDir = target
      restored = true
    }
  }
  const seriesPlanted = await restorePlantedFiles(client, seriesDir, seriesRecord?.files ?? [])
  removedAssets.push(...seriesPlanted.removed)
  restoredAssets.push(...seriesPlanted.restored)
  clearItemMetadata(itemId, { name: basenameRemotePath(seriesDir), num: '' })
  deleteImagesByItem(itemId)
  deleteCastByItems([itemId])

  // 2. 逐季逐集：季 NFO 只有季级资源记录，集 NFO 才带「原集文件名 + 原目录」
  const roots = libraryRoots(libraryId, item.connectionId)
  for (const season of listSeasonItems(libraryId, itemId)) {
    const seasonDir = season.path
    removedNfo.push(...(await removeNfoFiles(client, seasonDir, [SEASON_NFO_NAME])))
    const seasonRecord = await readRestore(client, seasonDir, [SEASON_NFO_NAME])
    const seasonPlanted = await restorePlantedFiles(client, seasonDir, seasonRecord?.files ?? [])
    removedAssets.push(...seasonPlanted.removed)
    restoredAssets.push(...seasonPlanted.restored)
    clearItemMetadata(season.id, { name: basenameRemotePath(seasonDir), num: '' })
    deleteImagesByItem(season.id)

    for (const episode of listEpisodeItems(libraryId, season.id)) {
      const sources = listSourcesByItem(episode.id)
      const source = primarySourceOf(episode, sources)
      if (!source) {
        // 扫描之后文件已不在：只能清库内刮削数据
        clearItemMetadata(episode.id, { name: episode.name, num: '' })
        deleteImagesByItem(episode.id)
        deleteCastByItems([episode.id])
        continue
      }

      // NFO 跟集文件同名，而条目 `name` 已经被刮削标题覆盖，名字只能从媒体源文件名反推；
      // 同一集的多个版本各自有一份 NFO，全都要删干净
      const episodeDir = dirnameRemotePath(source.path)
      const names = sources.map((row) => nfoFileName(stripExtension(row.name)))
      const episodeRecord = await readRestore(client, episodeDir, names)
      removedNfo.push(...(await removeNfoFiles(client, episodeDir, names)))
      const episodePlanted = await restorePlantedFiles(
        client,
        episodeDir,
        episodeRecord?.files ?? []
      )
      removedAssets.push(...episodePlanted.removed)
      restoredAssets.push(...episodePlanted.restored)

      let finalPath = source.path
      let episodeRestored = false
      if (episodeRecord) {
        const target = joinRemotePath(episodeRecord.directory, episodeRecord.fileName)
        if (normalizeRemotePath(target) === normalizeRemotePath(source.path)) {
          episodeRestored = true
        } else if (
          !(await existsOrTrue(client, target)) &&
          (await moveFile(client, source.path, target))
        ) {
          await refreshSourcePath(client, source.connectionId, episode.id, source.path, target)
          finalPath = target
          episodeRestored = true
        }
      }
      if (episodeRestored) restored = true

      // 还原口径与扫描一致：展示名 = 磁盘上的集文件名（含扩展名），番号从该文件名解析
      const fileName = basenameRemotePath(finalPath)
      clearItemMetadata(episode.id, {
        name: fileName,
        num: normalizeNum(extractKeyword(fileName).num)
      })
      deleteImagesByItem(episode.id)
      deleteCastByItems([episode.id])

      // 集搬走后自己建出来、现在已搬空的集目录顺手删掉
      const removedEpisodeDir = await removeEmptyDir(client, episodeDir, roots)
      if (removedEpisodeDir.length > 0) removedDirs.push(removedEpisodeDir)
    }

    // 季资源删完、集也搬走之后，规范化改名出来的季目录通常已经搬空
    const removedSeasonDir = await removeEmptyDir(client, seasonDir, roots)
    if (removedSeasonDir.length > 0) removedDirs.push(removedSeasonDir)
  }

  return {
    itemId,
    removedNfo,
    removedAssets,
    restoredAssets,
    restored,
    path: seriesDir,
    removedDirs
  }
}
