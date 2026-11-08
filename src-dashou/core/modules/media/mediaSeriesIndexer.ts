/**
 * 剧集索引引擎：把剧集库连接里的目录扫成 `series → season → episode` 三层条目。
 *
 * 契约：
 * - 目录角色只看「目录名 + 直接内容」，与资料库设置无关：
 *   * **剧集目录**：直接含视频，或含「季目录」子目录（`Season 01` / `S1` / `第1季` / `Specials`）；
 *   * **季目录**：剧集目录下的子目录（含视频的更深一层目录沿用父级季上下文，不再新建条目）；
 *   * **花絮 / 样片目录**（`Extras`、`Featurettes`、`Sample`、`Trailers`…）整棵跳过，里面的视频不入库
 *     （`Specials` / `OVA` / `OAD` 属**季目录**、季号 0，不跳过）；
 * - 资料库根目录自己就是剧集目录时（库直接指向某个剧集文件夹）照常建剧集条目，但刮削阶段不会给它改名；
 * - 季号：**目录名写明季号时以目录为准**；目录名没写（剧集目录里直接放视频）时用文件名里的季号；
 * - 集号只认文件名，认不出来（`parseEpisodeNumbers` 返回 null）就**不入库**，并计入 `skippedVideos`；
 * - 季目录里的集挂季条目下；剧集目录里直接放的集挂剧集条目下（`parent_id = seriesId`，`seasonNumber` 仍是真实季号），
 *   读取侧要把两种都算进同一季；
 * - **多版本**：同一季同集号的多个文件（`S01E01.mkv` + `S01E01 - 1080p.mkv`）合成**一条 `episode`**，
 *   条目 `path` 取自然序第一个（主版本），其余文件各写一条 `media_source`；
 * - 图片：与集同名的图当集主图，`<集名>-poster.jpg` 这类前缀名按用途挂集，
 *   其余固定名（poster / backdrop / banner / logo / fanart…）挂当前目录的条目（剧集或季）；
 *   `extrafanart` / `extrathumbs` 里的图挂上一层条目；用户自己放的其他图不归扫描管；
 * - NFO：`tvshow.nfo` 记剧集的 `hasNfo`，`season.nfo` 记季的，与集同名的 `.nfo` 记集的；
 *   未刮削（`scrapedAt = 0`）的条目按 `./mediaNfoScan` 把 NFO 里的元数据与名单读进库，已刮削的跳过。
 *
 * 条目 ID / 身份认领 / 写入在 `./mediaSeriesItems`，本文件只管目录遍历、图片归属与清理。
 */
import { LibraryError, type MediaLibrary } from '@common/types/library'
import {
  basenameRemotePath,
  dirnameRemotePath,
  isRemotePathInside,
  type FileEntry
} from '@common/types/file'
import {
  extraKindOfName,
  isExtraVideoDir,
  mediaSourceKindOf,
  parseEpisodeNumbers,
  seasonNumberOfDir,
  type MediaImageType
} from '@common/types/media'
import { padNumber, stripExtension } from '@common/types/scrape'
import { deleteImagesByIds, listImagesByLibrary, upsertImage } from '$/db/repo/mediaImageRepo'
import {
  deleteChildlessItems,
  deleteItemsWithoutSource,
  deleteSourcesNotInScan
} from '$/db/repo/mediaCleanupRepo'
import { getItem } from '$/db/repo/mediaRepo'
import { getFileClient } from '$/modules/file/fileClientManager'
import {
  collectNfoBases,
  importEpisodeNfo,
  importSeasonNfo,
  importSeriesNfo
} from './mediaNfoScan'
import {
  MAX_SCAN_DEPTH,
  MAX_SCAN_ENTRIES,
  emptyResult,
  extraArtAnchor,
  imageKey,
  imageTypeOfBaseName,
  isBigEnoughVideo,
  isScanOwnedImagePath,
  isVideoExtension,
  mediaImageId,
  minBytesOf,
  type IndexPathOptions,
  type IndexPathResult
} from './mediaScanCommon'
import {
  ensureSeasonItem,
  ensureSeriesItem,
  indexEpisode,
  type DirContext,
  type EpisodeGroup
} from './mediaSeriesItems'

/** 一个目录能给图片提供的落点 */
interface SeriesImageTarget {
  /** 目录条目 ID（剧集或季）；连接根等没有条目时为空串 */
  anchorId: string
  /** 视频基础名（小写）→ 集条目 ID */
  videoBases: Map<string, string>
}

/** 认出一张图的归属：先找同名 / 前缀名的集，再按固定名挂当前目录条目 */
function seriesImageSlot(
  target: SeriesImageTarget,
  image: FileEntry
): { itemId: string; type: MediaImageType } | null {
  const base = stripExtension(image.name).toLowerCase()
  const sameName = target.videoBases.get(base)
  if (sameName !== undefined) return { itemId: sameName, type: 'primary' }
  for (const [videoBase, itemId] of target.videoBases) {
    if (!base.startsWith(`${videoBase}-`)) continue
    const type = imageTypeOfBaseName(base.slice(videoBase.length + 1))
    if (type !== null) return { itemId, type }
  }
  const type = imageTypeOfBaseName(base)
  if (type === null || target.anchorId.length === 0) return null
  return { itemId: target.anchorId, type }
}

/** 索引一个目录里的图片 */
function indexSeriesImages(
  library: MediaLibrary,
  connectionId: string,
  target: SeriesImageTarget,
  files: readonly FileEntry[],
  result: IndexPathResult
): void {
  for (const image of files) {
    if (mediaSourceKindOf(image.mime, image.extname) !== 'image') continue
    const slot = seriesImageSlot(target, image)
    if (!slot) continue
    upsertImage({
      id: mediaImageId(connectionId, image.path),
      itemId: slot.itemId,
      libraryId: library.id,
      type: slot.type,
      connectionId,
      path: image.path,
      width: 0,
      height: 0
    })
    result.seenImages.add(imageKey(connectionId, image.path))
  }
}

/**
 * 扫描剧集资料库的**一个**媒体目录（递归）。
 *
 * 取消时抛 `LibraryError('cancelled')`，由调用方决定是否清理。
 */
export async function indexSeriesLibraryPath(
  library: MediaLibrary,
  libPath: { connectionId: string; path: string },
  options: IndexPathOptions
): Promise<IndexPathResult> {
  const result = emptyResult()
  const connectionId = libPath.connectionId
  const client = await getFileClient(connectionId)
  const minBytes = minBytesOf(options.minFileSizeMb)
  const contextByDir = new Map<string, DirContext>()
  const queue: { path: string; depth: number }[] = [{ path: libPath.path, depth: 0 }]
  let cursor = 0
  let listed = 0

  while (cursor < queue.length) {
    if (options.isCancelled?.() === true) throw new LibraryError('cancelled')
    const node = queue[cursor]
    cursor += 1
    let entries: FileEntry[]
    try {
      entries = await client.list(node.path)
    } catch (error) {
      // 根目录都列不出来说明配置或连接坏了，直接报错
      if (node.depth === 0) {
        const message = error instanceof Error ? error.message : String(error)
        throw new LibraryError('scanFailed', `无法读取媒体目录：${message}`)
      }
      result.skippedDirs += 1
      result.skippedPaths.push(node.path)
      continue
    }
    listed += entries.length
    if (listed > MAX_SCAN_ENTRIES) {
      result.truncated = true
      break
    }
    result.scannedDirs += 1

    const files = entries.filter((entry) => entry.type === 'file')
    const subdirs = entries.filter((entry) => entry.type === 'directory')
    const videos = files.filter(
      (file) =>
        isVideoExtension(options.extensions, file.extname) &&
        isBigEnoughVideo(file, minBytes) &&
        extraKindOfName(stripExtension(file.name)).length === 0
    )
    const nfoBases = collectNfoBases(files)
    const parent = contextByDir.get(dirnameRemotePath(node.path))
    const dirName = basenameRemotePath(node.path)
    const namedSeason = seasonNumberOfDir(dirName)

    // 1. 先定这个目录的角色
    let context: DirContext | null = null
    if (isExtraVideoDir(dirName)) {
      context = null
    } else if (parent?.kind === 'season') {
      // 季目录的更深一层（`Season 01/CD1/`）：沿用父级季，不新建条目
      context = parent
    } else if (parent?.kind === 'series') {
      const season = namedSeason ?? 1
      const seasonItem = ensureSeasonItem(
        library,
        connectionId,
        parent.seriesId,
        node.path,
        season,
        namedSeason === null ? `Season ${padNumber(season)}` : dirName,
        nfoBases
      )
      context = {
        kind: 'season',
        itemId: seasonItem.itemId,
        itemPath: node.path,
        seriesId: parent.seriesId,
        season,
        namedSeason: namedSeason !== null
      }
      if (namedSeason !== null) {
        await importSeasonNfo(
          client,
          { id: seasonItem.itemId, path: node.path, scrapedAt: seasonItem.scrapedAt },
          files,
          season
        )
      }
    } else if (
      videos.length > 0 ||
      subdirs.some((dir) => seasonNumberOfDir(basenameRemotePath(dir.path)) !== null)
    ) {
      const seriesId = ensureSeriesItem(library, connectionId, node.path, nfoBases)
      context = {
        kind: 'series',
        itemId: seriesId,
        itemPath: node.path,
        seriesId,
        season: 0,
        namedSeason: false
      }
      const series = getItem(seriesId)
      if (series) await importSeriesNfo(client, series, files)
    }

    // 2. 收这一层的视频：同季同集号的多个文件是同一集的多版本，合成一个条目；解析不出来的不入库
    const videoBases = new Map<string, string>()
    if (context === null) {
      result.skippedVideos += videos.length
    } else {
      const groups = new Map<string, EpisodeGroup>()
      for (const video of videos) {
        const parsed = parseEpisodeNumbers(video.name, context.namedSeason ? context.season : 1)
        if (!parsed) {
          result.skippedVideos += 1
          continue
        }
        // 目录名写明季号时以目录为准；剧集目录直接放视频时用文件名里的季号
        const season = context.namedSeason ? context.season : parsed.season
        const key = `${season}\n${parsed.episode}`
        const group = groups.get(key)
        if (group) group.videos.push(video)
        else groups.set(key, { season, episode: parsed.episode, videos: [video] })
      }
      for (const group of groups.values()) {
        const parentId =
          context.kind === 'season' && context.namedSeason
            ? context.itemId
            : ensureSeasonItem(
                library,
                connectionId,
                context.seriesId,
                context.itemPath,
                group.season,
                `Season ${padNumber(group.season)}`,
                nfoBases
              ).itemId
        const episode = indexEpisode(
          library,
          connectionId,
          options.scanId,
          parentId,
          group,
          nfoBases
        )
        result.indexedVideos += group.videos.length
        result.indexedFiles += group.videos.length
        for (const video of group.videos) {
          videoBases.set(stripExtension(video.name).toLowerCase(), episode.itemId)
        }
        await importEpisodeNfo(
          client,
          { id: episode.itemId, path: episode.primaryPath, scrapedAt: episode.scrapedAt },
          files,
          group.videos
        )
      }
    }

    // 3. 图片：固定名挂本目录条目，同名 / 前缀名挂集；`extrafanart` 里的图挂上一层条目
    const anchorPath = extraArtAnchor(node.path)
    const anchorId =
      context?.itemId ?? (anchorPath === null ? '' : (contextByDir.get(anchorPath)?.itemId ?? ''))
    if (anchorId.length > 0 || videoBases.size > 0) {
      indexSeriesImages(library, connectionId, { anchorId, videoBases }, files, result)
    }

    if (context) contextByDir.set(node.path, context)
    options.onDir?.({
      dirPath: node.path,
      scannedDirs: result.scannedDirs,
      indexedFiles: result.indexedFiles
    })
    if (node.depth >= MAX_SCAN_DEPTH) {
      result.truncated = true
      continue
    }
    for (const dir of subdirs) {
      // 花絮 / 样片目录整棵跳过：不放它们进队列，里面的视频才不会在更深一层被当成新的剧集
      if (isExtraVideoDir(basenameRemotePath(dir.path))) continue
      queue.push({ path: dir.path, depth: node.depth + 1 })
    }
  }
  return result
}

/**
 * 清理剧集库本次扫描没看到的条目，返回被删掉的**剧集**条目数。
 *
 * 顺序：先删失去全部媒体源的集，再自底向上收掉空壳的季与剧集，最后删旧媒体源与磁盘上消失的刮削图。
 * `skippedDirs`（列目录失败被跳过的目录）下的数据一律保留。
 */
export function cleanupSeriesUnseen(
  libraryId: string,
  scanId: string,
  keepImages: ReadonlySet<string>,
  skippedDirs: readonly string[] = []
): number {
  const episodes = deleteItemsWithoutSource(libraryId, scanId, skippedDirs, ['episode'])
  const seasons = deleteChildlessItems(libraryId, ['season'], skippedDirs)
  const series = deleteChildlessItems(libraryId, ['series'], skippedDirs)
  const orphans = [...episodes, ...seasons, ...series]
  if (orphans.length > 0) deleteImagesByIds(orphans)
  deleteSourcesNotInScan(libraryId, scanId, skippedDirs)
  const staleImageIds = listImagesByLibrary(libraryId)
    .filter((row) => {
      if (skippedDirs.some((dir) => isRemotePathInside(dir, row.path))) return false
      if (!isScanOwnedImagePath(row.path)) return false
      return !keepImages.has(imageKey(row.connectionId, row.path))
    })
    .map((row) => row.id)
  if (staleImageIds.length > 0) deleteImagesByIds(staleImageIds)
  return series.length
}
