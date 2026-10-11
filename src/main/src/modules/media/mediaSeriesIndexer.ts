/**
 * 剧集索引引擎：把剧集库连接里的目录扫成 `series → season → episode` 三层条目。
 *
 * 契约：
 * - 目录角色只看「目录名 + 直接内容」，与资料库设置无关：
 *   * **剧集目录**：直接含视频，或含「季目录」子目录（`Season 01` / `S1` / `第1季` / `Specials`）；
 *   * **季目录**：剧集目录下的子目录（含视频的更深一层目录沿用父级季上下文，不再新建条目）；
 *   * **花絮 / 样片目录**（`Extras`、`Featurettes`、`Sample`、`OVA`…）整棵跳过，里面的视频不入库；
 * - 资料库根目录自己就是剧集目录时（库直接指向某个剧集文件夹）照常建剧集条目，但刮削阶段不会给它改名；
 * - 季号：**目录名写明季号时以目录为准**；目录名没写（剧集目录里直接放视频）时用文件名里的季号；
 * - 集号只认文件名，认不出来（`parseEpisodeName` 返回 null）就**不入库**，并计入 `skippedVideos`；
 * - 季目录里的集挂季条目下；剧集目录里直接放的集挂剧集条目下（`parent_id = seriesId`，`seasonNumber` 仍是真实季号），
 *   读取侧要把两种都算进同一季；
 * - 条目身份按「连接 + 路径」认（`findItemByPath`），且**只认同类型条目**：同一个目录从「剧集」变成「季」时不复用旧行；
 *   刮削改名后就地改写路径、id 不变，重扫既不会造重复、也不会丢掉已写好的元数据；
 * - 图片：与集同名的图当集主图，`<集名>-poster.jpg` 这类前缀名按用途挂集，
 *   其余固定名（poster / backdrop / banner / logo / fanart…）挂当前目录的条目（剧集或季）；
 *   `extrafanart` / `extrathumbs` 里的图挂上一层条目；用户自己放的其他图不归扫描管；
 * - `tvshow.nfo` / `season.nfo` 只作为 `hasNfo` 证据；未刮削的剧集条目会从 `tvshow.nfo` 补一次参演名单。
 */
import { createHash } from 'node:crypto'
import { LibraryError, type MediaLibrary } from '@common/types/library'
import {
  basenameRemotePath,
  dirnameRemotePath,
  guessMimeType,
  isRemotePathInside,
  type FileEntry
} from '@common/types/file'
import { mediaSourceKindOf, type MediaImageType } from '@common/types/media'
import { isExtraVideoDir, padNumber, parseEpisodeName, seasonNumberOfDir, stripExtension } from '@common/types/scrape'
import { deleteImagesByIds, listImagesByLibrary, upsertImage } from '$/db/repo/mediaImageRepo'
import {
  deleteChildlessItems,
  deleteItemsWithoutSource,
  deleteSourcesNotInScan
} from '$/db/repo/mediaCleanupRepo'
import { findItemByPath, getItem, insertItem, updateItem, upsertSource } from '$/db/repo/mediaRepo'
import type { MediaItemType } from '$/db/repo/mediaRepo'
import { getFileClient } from '$/modules/file/fileClientManager'
import { backfillCastFromNfo, backfillSeriesCastFromNfo, collectNfoBases, hasNfoEvidence } from './mediaNfoScan'
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
  mediaSourceId,
  minBytesOf,
  type IndexPathOptions,
  type IndexPathResult
} from './mediaIndexer'

function hashId(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 32)
}

/** 剧集条目 ID：`sha1('series\n' + libraryId + '\n' + connectionId + '\n' + 剧集目录路径)` */
export function seriesItemId(libraryId: string, connectionId: string, dirPath: string): string {
  return hashId(`series\n${libraryId}\n${connectionId}\n${dirPath}`)
}

/**
 * 季条目 ID：`sha1('season\n' + libraryId + '\n' + connectionId + '\n' + 季目录路径 + '\n' + 季号)`。
 *
 * 带季号是因为「剧集目录里直接放视频」时，多个隐式季共用剧集目录这一个路径，只靠路径会撞 ID。
 */
export function seasonItemId(
  libraryId: string,
  connectionId: string,
  dirPath: string,
  seasonNumber: number
): string {
  return hashId(`season\n${libraryId}\n${connectionId}\n${dirPath}\n${seasonNumber}`)
}

/** 集条目 ID：`sha1('episode\n' + connectionId + '\n' + 视频路径)` */
export function episodeItemId(connectionId: string, path: string): string {
  return hashId(`episode\n${connectionId}\n${path}`)
}

/**
 * 认领同类型条目：先按「连接 + 路径」找，再按确定性 ID 找，都没有就当新条目。
 *
 * 同一路径上可能存在不同类型的条目（例如剧集目录与它的隐式季共用路径），因此必须比对 `type`。
 */
function resolveItemId(
  connectionId: string,
  path: string,
  type: MediaItemType,
  candidateId: string
): { id: string; exists: boolean } {
  const byPath = findItemByPath(connectionId, path)
  if (byPath && byPath.type === type) return { id: byPath.id, exists: true }
  const byId = getItem(candidateId)
  if (byId && byId.type === type) return { id: candidateId, exists: true }
  return { id: candidateId, exists: false }
}

/** 目录在剧集树里的角色：剧集目录，或某个剧集的某一季 */
interface DirContext {
  kind: 'series' | 'season'
  /** 该目录对应的条目 ID（剧集目录 → 剧集条目；季目录 → 季条目） */
  itemId: string
  /** 条目所在的目录路径（隐式季就落在剧集目录上；更深一层目录沿用祖先的路径） */
  itemPath: string
  seriesId: string
  /** 季号；剧集目录为 0 */
  season: number
  /** 季号是否由目录名写明（写明时以目录为准，否则用文件名里的季号） */
  namedSeason: boolean
}

/** 建好 / 更新剧集条目，返回条目 ID */
function ensureSeriesItem(
  library: MediaLibrary,
  connectionId: string,
  dirPath: string,
  nfoBases: ReadonlySet<string>
): string {
  const { id, exists } = resolveItemId(
    connectionId,
    dirPath,
    'series',
    seriesItemId(library.id, connectionId, dirPath)
  )
  const hasNfo = nfoBases.has('tvshow') ? 1 : 0
  if (exists) {
    // 重扫只修父子关系与 NFO 证据，名字交给刮削结果
    updateItem(id, { parentId: '', hasNfo })
  } else {
    insertItem({
      id,
      libraryId: library.id,
      connectionId,
      type: 'series',
      parentId: '',
      path: dirPath,
      name: basenameRemotePath(dirPath),
      hasNfo
    })
  }
  return id
}

/** 建好 / 更新季条目，返回条目 ID */
function ensureSeasonItem(
  library: MediaLibrary,
  connectionId: string,
  seriesId: string,
  dirPath: string,
  seasonNumber: number,
  name: string
): string {
  const { id, exists } = resolveItemId(
    connectionId,
    dirPath,
    'season',
    seasonItemId(library.id, connectionId, dirPath, seasonNumber)
  )
  if (exists) updateItem(id, { parentId: seriesId, seasonNumber })
  else {
    insertItem({
      id,
      libraryId: library.id,
      connectionId,
      type: 'season',
      parentId: seriesId,
      path: dirPath,
      name,
      seasonNumber
    })
  }
  return id
}

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
      (file) => isVideoExtension(options.extensions, file.extname) && isBigEnoughVideo(file, minBytes)
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
      context = {
        kind: 'season',
        itemId: ensureSeasonItem(
          library,
          connectionId,
          parent.seriesId,
          node.path,
          season,
          namedSeason === null ? `Season ${padNumber(season)}` : dirName
        ),
        itemPath: node.path,
        seriesId: parent.seriesId,
        season,
        namedSeason: namedSeason !== null
      }
    } else if (videos.length > 0 || subdirs.some((dir) => seasonNumberOfDir(basenameRemotePath(dir.path)) !== null)) {
      const seriesId = ensureSeriesItem(library, connectionId, node.path, nfoBases)
      context = {
        kind: 'series',
        itemId: seriesId,
        itemPath: node.path,
        seriesId,
        season: 0,
        namedSeason: false
      }
      if ((getItem(seriesId)?.scrapedAt ?? 0) === 0) {
        await backfillSeriesCastFromNfo(client, seriesId, files)
      }
    }

    // 2. 收这一层的视频：解析季 / 集号，解析不出来的不入库
    const videoBases = new Map<string, string>()
    for (const video of videos) {
      if (!context) {
        result.skippedVideos += 1
        continue
      }
      const parsed = parseEpisodeName(video.name, context.namedSeason ? context.season : 1)
      if (!parsed) {
        result.skippedVideos += 1
        continue
      }
      // 目录名写明季号时以目录为准；剧集目录直接放视频时用文件名里的季号
      const season = context.namedSeason ? context.season : parsed.season
      const parentId =
        context.kind === 'season' && context.namedSeason
          ? context.itemId
          : ensureSeasonItem(
              library,
              connectionId,
              context.seriesId,
              context.itemPath,
              season,
              `Season ${padNumber(season)}`
            )
      const existing = findItemByPath(connectionId, video.path)
      const item = resolveItemId(connectionId, video.path, 'episode', episodeItemId(connectionId, video.path))
      const hasNfo = hasNfoEvidence(video, nfoBases)
      if (item.exists) {
        updateItem(item.id, { parentId, seasonNumber: season, episodeNumber: parsed.episode, hasNfo })
      } else {
        insertItem({
          id: item.id,
          libraryId: library.id,
          connectionId,
          type: 'episode',
          parentId,
          path: video.path,
          name: video.name,
          seasonNumber: season,
          episodeNumber: parsed.episode,
          hasNfo
        })
      }
      upsertSource(
        {
          id: mediaSourceId(connectionId, video.path),
          itemId: item.id,
          libraryId: library.id,
          connectionId,
          path: video.path,
          name: video.name,
          extname: video.extname,
          mime: video.mime || guessMimeType(video.name),
          size: video.size,
          modifiedAt: video.modifiedAt
        },
        options.scanId
      )
      result.indexedVideos += 1
      result.indexedFiles += 1
      videoBases.set(stripExtension(video.name).toLowerCase(), item.id)
      if ((existing?.scrapedAt ?? 0) === 0) await backfillCastFromNfo(client, item.id, files, video)
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
    for (const dir of subdirs) queue.push({ path: dir.path, depth: node.depth + 1 })
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
