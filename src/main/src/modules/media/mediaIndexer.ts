/**
 * 媒体索引引擎：把连接里的视频文件扫成 `media_item` / `media_source` / `media_image`。
 *
 * 契约：
 * - 每条资料库目录独立调用 `indexLibraryPath`，游标队列 BFS（上限 200k 条、32 层）；
 * - 根目录列目录失败直接抛错；子目录失败计入 `skippedDirs` 继续扫；
 * - 条目 ID 是确定性的（sha1 前 32 位），重扫按路径 upsert：只刷新扫描拥有的列，
 *   刮削元数据（name/num/元数据列/scrapedAt）一律保留；
 * - 图片按「连接 + 路径」唯一：与视频同名的图片挂影片条目当主图；目录级固定名
 *   （poster / fanart / thumb / still…）与 `<视频名>-<固定名>` 前缀名按用途挂影片或目录条目；
 *   `extrafanart` / `extrathumbs` 子目录里的图算上一层目录影片的产出；
 * - 同目录有 `movie.nfo` 或与视频同名的 `.nfo` 时把 `hasNfo = 1` 记在影片条目上，
 *   仅作为「磁盘上有没有 NFO」的事实标记（影视墙不再按它分类）；
 * - 哪些后缀算视频由调用方按资料库设置传入（`IndexPathOptions.extensions`），
 *   本文件不硬编码扩展名；
 * - `cleanupUnseen` 删除本次没扫到的媒体源、失去源的影片条目与其图片。
 */
import { createHash } from 'node:crypto'
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
import { mediaSourceKindOf, type MediaImageType } from '@common/types/media'
import { getFileClient } from '$/modules/file/fileClientManager'
import { deleteImagesByIds, listImagesByLibrary, upsertImage } from '$/db/repo/mediaImageRepo'
import {
  deleteItemsWithoutSource,
  deleteSourcesNotInScan,
  getItem,
  insertItem,
  insertSource,
  updateItem,
  upsertSource
} from '$/db/repo/mediaRepo'

/** 单次扫描的条目上限（沿用旧索引实现的语义） */
export const MAX_SCAN_ENTRIES = 200_000
/** 单次扫描的最大目录深度（沿用旧索引实现的语义） */
export const MAX_SCAN_DEPTH = 32

/** 目录级主图名（与视频不同名时挂目录条目） */
const DIR_PRIMARY_NAMES: ReadonlySet<string> = new Set(['poster', 'cover', 'folder'])
/** 目录级背景图名 */
const DIR_BACKDROP_NAMES: ReadonlySet<string> = new Set(['fanart', 'backdrop', 'background'])
/** 目录级缩略图名（`thumb` / `thumb1` / `thumbs2`…） */
const DIR_THUMB_NAMES = /^thumbs?\d*$/
/** 目录级剧照名（`still` / `still1` / `screenshots2`…） */
const DIR_STILL_NAMES = /^(?:still|screenshot)s?\d*$/
/** 剧照 / 缩略图子目录：里面的图片属于**上一层**目录里的影片 */
const EXTRA_ART_DIR_NAMES: ReadonlySet<string> = new Set(['extrafanart', 'extrathumbs'])

/** 图片基础名（去扩展名、小写）→ 用途；不是固定图片名时返回 null */
function imageTypeOfBaseName(base: string): MediaImageType | null {
  if (DIR_PRIMARY_NAMES.has(base)) return 'primary'
  if (DIR_BACKDROP_NAMES.has(base)) return 'backdrop'
  if (DIR_THUMB_NAMES.test(base)) return 'thumb'
  if (DIR_STILL_NAMES.test(base)) return 'still'
  return null
}

/**
 * 图片是不是刮削产物名：目录级固定名（`poster.jpg` / `thumb.jpg` / `still1.jpg`…），
 * 或者 `<视频基础名>-<固定名>.jpg`（刮削关掉重命名时的附属文件命名，见 `resolveAssetFile`）。
 *
 * 只有这类图片会被清理（`cleanupUnseen`）；用户自己放的其他图不归扫描管。
 */
function isScanOwnedImagePath(path: string): boolean {
  const base = stripExtension(basenameRemotePath(path)).toLowerCase()
  if (imageTypeOfBaseName(base) !== null) return true
  const dash = base.lastIndexOf('-')
  return dash > 0 && imageTypeOfBaseName(base.slice(dash + 1)) !== null
}

function hashId(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 32)
}

/** 影片条目 ID：`sha1('item\n' + connectionId + '\n' + path)` */
export function movieItemId(connectionId: string, path: string): string {
  return hashId(`item\n${connectionId}\n${path}`)
}

/** 目录条目 ID：`sha1('folder\n' + libraryId + '\n' + connectionId + '\n' + dirPath)` */
export function folderItemId(libraryId: string, connectionId: string, dirPath: string): string {
  return hashId(`folder\n${libraryId}\n${connectionId}\n${dirPath}`)
}

/** 媒体源 ID：`sha1('source\n' + connectionId + '\n' + path)` */
export function mediaSourceId(connectionId: string, path: string): string {
  return hashId(`source\n${connectionId}\n${path}`)
}

/** 图片 ID：`sha1('image\n' + connectionId + '\n' + path)` */
export function mediaImageId(connectionId: string, path: string): string {
  return hashId(`image\n${connectionId}\n${path}`)
}

/** 扫描清理用的图片键（连接 + 路径） */
export function imageKey(connectionId: string, path: string): string {
  return `${connectionId}\n${path}`
}

export interface IndexDirProgress {
  dirPath: string
  scannedDirs: number
  indexedFiles: number
}

export interface IndexPathOptions {
  scanId: string
  /** 该资料库识别为影片的后缀清单（小写、无点，来自 `libraryExtensionsOf`） */
  extensions: readonly string[]
  onDir?: (progress: IndexDirProgress) => void
  isCancelled?: () => boolean
}

export interface IndexPathResult {
  /** 本次写入 / 更新的媒体源数 */
  indexedFiles: number
  /** 其中的视频数 */
  indexedVideos: number
  /** 列目录失败被跳过的目录数 */
  skippedDirs: number
  /** 被跳过的目录路径（清理时要避开这些前缀） */
  skippedPaths: string[]
  /** 成功列出的目录数 */
  scannedDirs: number
  /** 是否因为条目上限或深度上限提前收工 */
  truncated: boolean
  /** 本次扫到的图片键集合（cleanupUnseen 用） */
  seenImages: Set<string>
}

function emptyResult(): IndexPathResult {
  return {
    indexedFiles: 0,
    indexedVideos: 0,
    skippedDirs: 0,
    skippedPaths: [],
    scannedDirs: 0,
    truncated: false,
    seenImages: new Set<string>()
  }
}

function isCancelled(options: IndexPathOptions): boolean {
  return options.isCancelled?.() === true
}

function isImageEntry(entry: FileEntry): boolean {
  return mediaSourceKindOf(entry.mime, entry.extname) === 'image'
}

/**
 * 文件是不是影片：拿传入的后缀清单比对。
 *
 * `entry.extname` 通常已经是无点小写，但脏数据可能带点、大写或空白，这里统一清洗后再比。
 */
function isVideoExtension(extensions: readonly string[], extname: string): boolean {
  const ext = extname.trim().replace(/^\.+/, '').toLowerCase()
  return extensions.includes(ext)
}

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

/** 写入一个视频文件对应的影片条目 + 媒体源 */
function indexVideo(
  library: MediaLibrary,
  connectionId: string,
  scanId: string,
  parentId: string,
  entry: FileEntry,
  hasNfo: number
): void {
  const itemId = movieItemId(connectionId, entry.path)
  const existing = getItem(itemId)
  if (existing) {
    // 重扫只修父子关系与 NFO 证据，文件名与番号交给刮削结果
    updateItem(itemId, { parentId, hasNfo })
  } else {
    insertItem({
      id: itemId,
      libraryId: library.id,
      connectionId,
      type: 'movie',
      parentId,
      path: entry.path,
      name: entry.name,
      num: normalizeNum(extractKeyword(entry.name).num),
      hasNfo
    })
  }
  const source = {
    id: mediaSourceId(connectionId, entry.path),
    itemId,
    libraryId: library.id,
    connectionId,
    path: entry.path,
    name: entry.name,
    extname: entry.extname,
    mime: entry.mime || guessMimeType(entry.name),
    size: entry.size,
    modifiedAt: entry.modifiedAt
  }
  if (existing) upsertSource(source, scanId)
  else insertSource(source, scanId)
}

/** 一个目录能给图片提供的落点 */
interface ImageTarget {
  /** 目录条目 ID（连接根没有条目，为空串） */
  parentId: string
  /** 视频基础名（小写）→ 视频路径 */
  videoBases: Map<string, string>
  /** 目录里只有一个视频时是它的路径，否则空串（连接根没有目录条目时靠它兜底） */
  singleVideoPath: string
}

/** 按目录里的文件算出图片落点 */
function buildImageTarget(
  parentId: string,
  files: readonly FileEntry[],
  extensions: readonly string[]
): ImageTarget {
  const videoBases = new Map<string, string>()
  const videos = files.filter((file) => isVideoExtension(extensions, file.extname))
  for (const video of videos) videoBases.set(stripExtension(video.name).toLowerCase(), video.path)
  return { parentId, videoBases, singleVideoPath: videos.length === 1 ? videos[0].path : '' }
}

/** 目录级图片的落点：优先目录条目，连接根下只有唯一影片时挂给它 */
function dirTargetOf(connectionId: string, target: ImageTarget): string {
  if (target.parentId.length > 0) return target.parentId
  return target.singleVideoPath.length > 0 ? movieItemId(connectionId, target.singleVideoPath) : ''
}

/** 图片的归属（条目 + 用途）；认不出来的图片返回 null */
function imageSlotOf(
  connectionId: string,
  target: ImageTarget,
  image: FileEntry
): { itemId: string; type: MediaImageType } | null {
  const base = stripExtension(image.name).toLowerCase()
  const sameName = target.videoBases.get(base)
  if (sameName !== undefined) return { itemId: movieItemId(connectionId, sameName), type: 'primary' }
  // `<视频基础名>-poster.jpg` 这类前缀命名
  for (const [videoBase, videoPath] of target.videoBases) {
    if (!base.startsWith(`${videoBase}-`)) continue
    const type = imageTypeOfBaseName(base.slice(videoBase.length + 1))
    if (type !== null) return { itemId: movieItemId(connectionId, videoPath), type }
  }
  const type = imageTypeOfBaseName(base)
  if (type === null) return null
  const itemId = dirTargetOf(connectionId, target)
  return itemId.length > 0 ? { itemId, type } : null
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
    const slot = imageSlotOf(connectionId, target, image)
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

/** 目录里所有 NFO 的基础名（小写）；`movie` 表示目录级 NFO */
function collectNfoBases(files: readonly FileEntry[]): ReadonlySet<string> {
  const bases = new Set<string>()
  for (const file of files) {
    if (mediaSourceKindOf(file.mime, file.extname) !== 'nfo') continue
    bases.add(stripExtension(file.name).toLowerCase())
  }
  return bases
}

/** 同目录有 `movie.nfo`（目录级）或与视频同名的 `.nfo` 时算「磁盘上已有 NFO 产出」 */
function hasNfoEvidence(file: FileEntry, nfoBases: ReadonlySet<string>): number {
  if (nfoBases.has('movie')) return 1
  return nfoBases.has(stripExtension(file.name).toLowerCase()) ? 1 : 0
}

/**
 * 剧照 / 缩略图子目录（`extrafanart`、`extrathumbs`，以及它们下面一层的 `S1` 这类目录）
 * 里的图片属于上一层目录里的影片，返回那个锚点目录；普通目录返回 null。
 */
function extraArtAnchor(dirPath: string): string | null {
  if (EXTRA_ART_DIR_NAMES.has(basenameRemotePath(dirPath).toLowerCase())) {
    return dirnameRemotePath(dirPath)
  }
  const parent = dirnameRemotePath(dirPath)
  if (parent !== FILE_ROOT && EXTRA_ART_DIR_NAMES.has(basenameRemotePath(parent).toLowerCase())) {
    return dirnameRemotePath(parent)
  }
  return null
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
  const folderCache = new Map<string, string>()
  /** 已扫过的目录 → 图片落点（extra 目录要回头找上一层目录） */
  const targetByDir = new Map<string, ImageTarget>()
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
    const parentId = ensureFolderItem(library, libPath.connectionId, node.path, folderCache)
    const files = entries.filter((entry) => entry.type === 'file')
    const target = buildImageTarget(parentId, files, options.extensions)
    targetByDir.set(node.path, target)
    const nfoBases = collectNfoBases(files)
    for (const file of files) {
      if (!isVideoExtension(options.extensions, file.extname)) continue
      indexVideo(library, libPath.connectionId, options.scanId, parentId, file, hasNfoEvidence(file, nfoBases))
      result.indexedVideos += 1
      result.indexedFiles += 1
    }
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
      if (entry.type === 'directory') queue.push({ path: entry.path, depth: node.depth + 1 })
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
  const orphanItemIds = deleteItemsWithoutSource(libraryId, scanId, skippedDirs)
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
