/**
 * 影片库索引引擎：把连接里的视频扫成 `media_item` / `media_source` / `media_image`。
 *
 * 目录与命名口径对齐 Jellyfin / Emby / Plex / Kodi（规则本体见 `@common/types/media/mediaRules`）：
 * - **一个影片目录 = 一个影片条目**（`Movies/片名 (年份)/`）；目录里以目录名为前缀的多个视频
 *   是同一部影片的多个版本（多条 `media_source`，挂在同一条目上）；
 * - 目录下只有一个视频、文件名与目录名对不上时，它仍然是这个目录的影片（`片名/movie.mkv`）；
 *   有多个且都对不上时各自独立成条目（条目路径 = 视频路径），连接根下的散装视频同样各自成条目；
 * - **花絮整棵跳过**：`extras` / `featurettes` / `trailers` 这类目录不下钻，
 *   `-trailer` / `-sample` 这类文件既不入库也不算版本（避免被当成正片）；
 * - 条目 ID 是确定性的（sha1 前 32 位），但重扫按「路径 / 媒体源」认身份（`findOwnedItem`）：
 *   刮削会把文件移进同名文件夹并就地改写库里的路径（id 不变），只有按路径认才既不会
 *   造出重复条目、也不会丢掉已刮好的元数据；只刷新扫描拥有的列，刮削元数据一律保留；
 * - 目录条目（`folder`）只为「自己没有影片的目录」建：影片目录自己就是影片条目，
 *   不再额外建同路径的目录条目，避免同一路径两条身份；
 * - 图片按「连接 + 路径」唯一：与视频同名的图片挂影片条目当主图；`<视频名>-poster.jpg`
 *   这类前缀名按用途挂影片；目录级固定名（poster / backdrop / thumb / banner / logo / fanartN…）
 *   挂目录里的影片条目（目录里有多个独立影片时挂目录条目）；`extrafanart` / `extrathumbs`
 *   子目录里的图算上一层目录影片的产出；
 * - 资料库设了最小体积（MB）时，小于它的视频不入库（体积未知的 0 字节条目仍然入库）；
 * - 同目录有 `movie.nfo` 或与视频同名的 `.nfo` 时把 `hasNfo = 1` 记在影片条目上，
 *   并按 `./mediaNfoScan` 把 NFO 里的元数据与名单读进库（已刮削过的条目跳过）；
 * - 哪些后缀算视频由调用方按资料库设置传入（`IndexPathOptions.extensions`），本文件不硬编码；
 * - `cleanupUnseen` 删除本次没扫到的媒体源、失去源的影片条目与其图片。
 *
 * 剧集库的 series → season → episode 扫描在 `./mediaSeriesIndexer`：本文件只保留影片 / 目录模型，
 * 以及两个索引器共用的底层工具（`isVideoExtension` / `minBytesOf` / `imageTypeOfBaseName` /
 * `extraArtAnchor` / `emptyResult` 等已导出，改这些函数的语义会同时影响两个索引器）。
 */
import type { MediaLibrary } from '@common/types/library'
import { LibraryError } from '@common/types/library'
import {
  FILE_ROOT,
  basenameRemotePath,
  dirnameRemotePath,
  guessMimeType,
  isRemotePathInside,
  type FileEntry
} from '@common/types/file'
import { extractKeyword, normalizeNum, stripExtension } from '@common/types/scrape'
import {
  extraKindOfName,
  isExtraVideoDir,
  isVersionOfFolder,
  type MediaImageType
} from '@common/types/media'
import { deleteImagesByIds, listImagesByLibrary, upsertImage } from '$/db/repo/mediaImageRepo'
import { getFileClient } from '$/modules/file/fileClientManager'
import { collectNfoBases, hasNfoEvidence, importMovieNfo } from './mediaNfoScan'
import {
  MAX_SCAN_DEPTH,
  MAX_SCAN_ENTRIES,
  emptyResult,
  extraArtAnchor,
  findOwnedItem,
  imageKey,
  imageTypeOfBaseName,
  isBigEnoughVideo,
  isCancelled,
  isImageEntry,
  isScanOwnedImagePath,
  isVideoExtension,
  mediaImageId,
  mediaSourceId,
  minBytesOf,
  movieItemId,
  folderItemId,
  type IndexPathOptions,
  type IndexPathResult
} from './mediaScanCommon'
import {
  deleteItemsWithoutSource,
  deleteSourcesNotInScan
} from '$/db/repo/mediaCleanupRepo'
import {
  getItem,
  insertItem,
  updateItem,
  upsertSource,
  type MediaItemScanPatch
} from '$/db/repo/mediaRepo'

/**
 * 按需创建目录条目并串起父子层级，返回目录条目 ID（连接根不建条目，返回空串）。
 */
function ensureFolderItem(
  library: MediaLibrary,
  connectionId: string,
  dirPath: string,
  cache: Map<string, string>
): string {
  if (dirPath === FILE_ROOT) return ''
  const key = `${connectionId}\n${dirPath}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const id = folderItemId(library.id, connectionId, dirPath)
  const parentId = ensureFolderItem(library, connectionId, dirnameRemotePath(dirPath), cache)
  const name = basenameRemotePath(dirPath)
  if (getItem(id)) {
    updateItem(id, { libraryId: library.id, connectionId, parentId, path: dirPath, name, type: 'folder' })
  } else {
    insertItem({ id, libraryId: library.id, connectionId, type: 'folder', parentId, path: dirPath, name })
  }
  cache.set(key, id)
  return id
}

/** 一个影片条目里的一组视频：目录型条目（`itemPath` 是目录）或文件型条目（`itemPath` 是视频） */
interface MovieGroup {
  itemPath: string
  videos: FileEntry[]
}

/**
 * 把一个目录里的视频分成影片条目，对齐 Jellyfin 的「一个影片目录 = 一个条目 + 多个版本」。
 *
 * - 以目录名为前缀的视频（`片名 (2021)/片名 (2021) - 1080p.mkv`）算同一部影片的多个版本，
 *   合成一个组，条目路径 = 目录；
 * - 目录下只有一个视频、文件名与目录名对不上时（`片名/movie.mkv`），它仍然是这个目录的影片；
 * - 其余情况每个视频各自成组（条目路径 = 视频路径）——**连接根例外**：根下的散装视频
 *   各自成条目，否则整个资料库会被合成一部影片；
 * - 目录里有多个独立影片时，除了各自的条目，还会给目录本身建一个 `folder` 条目承接目录级图片。
 */
function movieGroupsOf(
  dirPath: string,
  dirBase: string,
  videos: readonly FileEntry[],
  depth: number
): MovieGroup[] {
  if (videos.length === 0) return []
  const matching = videos.filter((video) => isVersionOfFolder(stripExtension(video.name), dirBase))
  const others = videos.filter((video) => !matching.includes(video))
  const groups: MovieGroup[] = []
  if (matching.length > 0) groups.push({ itemPath: dirPath, videos: matching })
  if (others.length === 1 && matching.length === 0 && depth > 0) {
    groups.push({ itemPath: dirPath, videos: others })
  } else {
    for (const video of others) groups.push({ itemPath: video.path, videos: [video] })
  }
  return groups
}

/**
 * 写入一个影片条目（含它的多个版本），返回条目 ID 与它当前的刮削时间。
 *
 * 条目身份按「条目路径 → 组内视频的媒体源 → 视频路径」逐级认（见 `./mediaScanCommon` 的
 * `findOwnedItem`）：刮削会把单文件移进同名文件夹并就地改写库里的路径（id 不变），
 * 手动搬动文件、换主版本时也能靠源找回条目、把路径改到新位置。
 * 已刮削过的条目只修父子关系、路径与 NFO 证据，标题与番号保持刮削结果。
 */
function indexMovieGroup(
  library: MediaLibrary,
  connectionId: string,
  scanId: string,
  parentId: string,
  group: MovieGroup,
  nfoBases: ReadonlySet<string>
): { itemId: string; scrapedAt: number } {
  const found = findOwnedItem(
    connectionId,
    group.itemPath,
    group.videos.map((video) => video.path),
    'movie'
  )
  const itemId = found?.id ?? movieItemId(connectionId, group.itemPath)
  const primary = group.videos[0]
  const dirTyped = group.itemPath !== primary.path
  const name = dirTyped ? basenameRemotePath(group.itemPath) : primary.name
  // 目录型条目的 NFO 常以**目录名**命名（多版本时视频名各不相同，只有它认得出来）
  const hasNfo =
    nfoBases.has('movie') ||
    (dirTyped && nfoBases.has(name.toLowerCase())) ||
    group.videos.some((video) => hasNfoEvidence(video, nfoBases) === 1)
      ? 1
      : 0
  if (found) {
    const patch: MediaItemScanPatch = { parentId, hasNfo }
    if (found.path !== group.itemPath) patch.path = group.itemPath
    if (found.scrapedAt === 0) {
      patch.name = name
      patch.num = normalizeNum(extractKeyword(name).num)
    }
    updateItem(itemId, patch)
  } else {
    insertItem({
      id: itemId,
      libraryId: library.id,
      connectionId,
      type: 'movie',
      parentId,
      path: group.itemPath,
      name,
      num: normalizeNum(extractKeyword(name).num),
      hasNfo
    })
  }
  for (const video of group.videos) {
    // 源一律走 upsertSource：它按 (connectionId, path) 认领，重新分组时会把源改挂到新条目
    upsertSource(
      {
        id: mediaSourceId(connectionId, video.path),
        itemId,
        libraryId: library.id,
        connectionId,
        path: video.path,
        name: video.name,
        extname: video.extname,
        mime: video.mime || guessMimeType(video.name),
        size: video.size,
        modifiedAt: video.modifiedAt
      },
      scanId
    )
  }
  return { itemId, scrapedAt: found?.scrapedAt ?? 0 }
}

/** 一个目录能给图片提供的落点 */
interface ImageTarget {
  /** 目录级固定名图片的落点（目录里的影片条目 / 目录条目），没有则空串 */
  dirItemId: string
  /** 目录名（小写）：`<目录名>-poster.jpg` 这类前缀名也挂目录级条目 */
  dirBase: string
  /** 视频基础名（小写）→ 影片条目 ID */
  videoItems: Map<string, string>
}

/** 图片的归属（条目 + 用途）；认不出来的图片返回 null */
function imageSlotOf(
  target: ImageTarget,
  image: FileEntry
): { itemId: string; type: MediaImageType } | null {
  const base = stripExtension(image.name).toLowerCase()
  const sameName = target.videoItems.get(base)
  if (sameName !== undefined) return { itemId: sameName, type: 'primary' }
  // `<视频基础名>-poster.jpg` 这类前缀命名
  for (const [videoBase, itemId] of target.videoItems) {
    if (!base.startsWith(`${videoBase}-`)) continue
    const type = imageTypeOfBaseName(base.slice(videoBase.length + 1))
    if (type !== null) return { itemId, type }
  }
  // `<目录名>-poster.jpg`：图片以目录名打头（多版本目录里视频名各不相同，只能这样认）
  if (target.dirBase.length > 0 && base.startsWith(`${target.dirBase}-`)) {
    const type = imageTypeOfBaseName(base.slice(target.dirBase.length + 1))
    if (type !== null && target.dirItemId.length > 0) return { itemId: target.dirItemId, type }
  }
  const type = imageTypeOfBaseName(base)
  if (type === null || target.dirItemId.length === 0) return null
  return { itemId: target.dirItemId, type }
}

/**
 * 索引一个目录里的图片：同名图片挂影片当主图，
 * 固定名 / 前缀名按用途挂影片或目录条目；`files` 与 `target` 要来自同一个目录。
 */
function indexImages(
  library: MediaLibrary,
  connectionId: string,
  target: ImageTarget,
  files: readonly FileEntry[],
  result: IndexPathResult
): void {
  for (const image of files) {
    if (!isImageEntry(image)) continue
    const slot = imageSlotOf(target, image)
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

interface QueueNode {
  path: string
  depth: number
}

/**
 * 扫描资料库的**一个**媒体目录（递归）。
 *
 * 取消时抛 `LibraryError('cancelled')`，由调用方决定是否清理。
 */
export async function indexLibraryPath(
  library: MediaLibrary,
  libPath: { connectionId: string; path: string },
  options: IndexPathOptions
): Promise<IndexPathResult> {
  const result = emptyResult()
  const client = await getFileClient(libPath.connectionId)
  const minBytes = minBytesOf(options.minFileSizeMb)
  const folderCache = new Map<string, string>()
  /** 已扫过的目录 → 图片落点（extra 目录要回头找上一层目录） */
  const targetByDir = new Map<string, ImageTarget>()
  /** 已扫过的目录 → 该目录自己的条目 ID（根目录为空串），子项靠它认父亲 */
  const itemIdByDir = new Map<string, string>()
  itemIdByDir.set(libPath.path, '')
  folderCache.set(`${libPath.connectionId}\n${libPath.path}`, '')
  const queue: QueueNode[] = [{ path: libPath.path, depth: 0 }]
  let cursor = 0
  let listed = 0
  while (cursor < queue.length) {
    if (isCancelled(options)) throw new LibraryError('cancelled')
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
    // 花絮文件（`-trailer` / `-sample`…）既不入库，也不算某个版本的替代品
    const videos = files.filter(
      (file) =>
        isVideoExtension(options.extensions, file.extname) &&
        isBigEnoughVideo(file, minBytes) &&
        extraKindOfName(stripExtension(file.name)).length === 0
    )
    const groups = movieGroupsOf(node.path, basenameRemotePath(node.path), videos, node.depth)
    const parentId = itemIdByDir.get(dirnameRemotePath(node.path)) ?? ''
    // 只有「自己没有影片」或「目录里有多个独立影片」的目录才额外建目录条目，
    // 影片目录自己就是影片条目（同一路径不再有两条身份）
    const folderId =
      groups.length === 1 && groups[0].itemPath === node.path
        ? ''
        : ensureFolderItem(library, libPath.connectionId, node.path, folderCache)
    const nfoBases = collectNfoBases(files)
    const itemIdByGroupPath = new Map<string, string>()
    for (const group of groups) {
      const indexed = indexMovieGroup(
        library,
        libPath.connectionId,
        options.scanId,
        parentId,
        group,
        nfoBases
      )
      itemIdByGroupPath.set(group.itemPath, indexed.itemId)
      result.indexedVideos += group.videos.length
      result.indexedFiles += group.videos.length
      await importMovieNfo(
        client,
        { id: indexed.itemId, path: group.itemPath, scrapedAt: indexed.scrapedAt },
        files,
        group.videos
      )
    }
    const ownItemId =
      groups.length === 1 && groups[0].itemPath === node.path
        ? (itemIdByGroupPath.get(node.path) ?? '')
        : folderId
    itemIdByDir.set(node.path, ownItemId)
    // 把「目录 → 自己的条目」写进同一个缓存：子目录往上找父亲时直接命中，
    // 不会给「本身就是影片条目的目录」再建一条同路径的目录条目
    folderCache.set(`${libPath.connectionId}\n${node.path}`, ownItemId)
    // 目录级图片挂目录自己的条目；连接根下只有一部影片时挂给它
    const dirItemId =
      ownItemId.length > 0
        ? ownItemId
        : (groups.length === 1 ? (itemIdByGroupPath.get(groups[0].itemPath) ?? '') : '')
    const videoItems = new Map<string, string>()
    for (const group of groups) {
      const itemId = itemIdByGroupPath.get(group.itemPath) ?? ''
      for (const video of group.videos) {
        videoItems.set(stripExtension(video.name).toLowerCase(), itemId)
      }
    }
    const target: ImageTarget = {
      dirItemId,
      dirBase: basenameRemotePath(node.path).toLowerCase(),
      videoItems
    }
    targetByDir.set(node.path, target)
    // 剧照 / 缩略图子目录里的图片按上一层目录（锚点）归属；锚点没扫到时就不收
    const anchor = extraArtAnchor(node.path)
    const imageTarget = anchor === null ? target : targetByDir.get(anchor)
    if (imageTarget) indexImages(library, libPath.connectionId, imageTarget, files, result)
    options.onDir?.({ dirPath: node.path, scannedDirs: result.scannedDirs, indexedFiles: result.indexedFiles })
    if (node.depth >= MAX_SCAN_DEPTH) {
      result.truncated = true
      continue
    }
    for (const entry of entries) {
      if (entry.type !== 'directory') continue
      // 花絮目录整棵不下钻：里面的视频不入库，图片也不当正片素材
      if (isExtraVideoDir(basenameRemotePath(entry.path))) continue
      queue.push({ path: entry.path, depth: node.depth + 1 })
    }
  }
  return result
}

/**
 * 清理本次扫描没看到的媒体数据，返回被删掉的影片条目数。
 *
 * 顺序很重要：先挑出「所有媒体源都不属于本次扫描」的条目（连带图片），再删旧源；
 * 另外清掉磁盘上已经消失的刮削产物图（固定名 / 前缀名），用户自己放的其他图不动。
 *
 * `skippedDirs` 是本次列目录失败被跳过的目录：它们下面的数据没有被扫到，
 * 但也没有从磁盘消失，因此整个清理过程都要避开这些前缀，避免一次读目录失败就删数据。
 */
export function cleanupUnseen(
  libraryId: string,
  scanId: string,
  keepImages: ReadonlySet<string>,
  skippedDirs: readonly string[] = []
): number {
  const orphanItemIds = deleteItemsWithoutSource(libraryId, scanId, skippedDirs, ['movie'])
  if (orphanItemIds.length > 0) deleteImagesByIds(orphanItemIds)
  deleteSourcesNotInScan(libraryId, scanId, skippedDirs)
  const staleImageIds = listImagesByLibrary(libraryId)
    .filter((row) => {
      if (skippedDirs.some((dir) => isRemotePathInside(dir, row.path))) return false
      if (!isScanOwnedImagePath(row.path)) return false
      return !keepImages.has(imageKey(row.connectionId, row.path))
    })
    .map((row) => row.id)
  if (staleImageIds.length > 0) deleteImagesByIds(staleImageIds)
  return orphanItemIds.length
}
