/**
 * 影片库 / 剧集库索引器共用的底层工具：ID 生成、后缀与体积判定、图片名归类、扫描结果形状。
 *
 * 这里的函数两个索引器都在用，改语义会同时影响两个库的扫描（例如 `imageTypeOfBaseName`
 * 决定目录级图片算主图还是背景图，`movieItemId` 决定条目 ID 稳不稳定）。
 *
 * 条目 ID 由「连接 + 路径」哈希而来，**不要改成自增**：重扫按路径认身份（`findItemByPath`），
 * 确定性 ID 让没改过名的条目在重扫前后是同一行，已经刮好的元数据才不会丢。
 */
import { createHash } from 'node:crypto'
import {
  FILE_ROOT,
  basenameRemotePath,
  dirnameRemotePath,
  type FileEntry
} from '@common/types/file'
import { mediaSourceKindOf, type MediaImageType } from '@common/types/media'
import { stripExtension } from '@common/types/scrape'
import { findItemByPath, findSourceByPath, getItem, type MediaItemType } from '$/db/repo/mediaRepo'
import type { MediaItemRow } from '$/db/schema'

/**
 * 认领扫描前已经存在的同类型条目，返回那一行（没有则 null）。
 *
 * 线索按可靠程度排：**目录 / 文件路径上的条目** → **组内视频的媒体源** → **视频路径上的条目**。
 * 媒体源这一层很关键：条目改名、换主版本、从单文件变成目录型时，条目路径会变，
 * 但源（连接 + 路径唯一）仍然指着同一个条目，靠它才不会造出重复条目、丢掉已刮好的元数据。
 */
export function findOwnedItem(
  connectionId: string,
  itemPath: string,
  videoPaths: readonly string[],
  type: MediaItemType
): MediaItemRow | null {
  const byPath = findItemByPath(connectionId, itemPath)
  if (byPath?.type === type) return byPath
  for (const path of videoPaths) {
    const source = findSourceByPath(connectionId, path)
    if (source === null) continue
    const item = getItem(source.itemId)
    if (item?.type === type) return item
  }
  for (const path of videoPaths) {
    const item = findItemByPath(connectionId, path)
    if (item?.type === type) return item
  }
  return null
}

/** 单次扫描的条目上限（沿用旧索引实现的语义） */
export const MAX_SCAN_ENTRIES = 200_000
/** 单次扫描的最大目录深度（沿用旧索引实现的语义） */
export const MAX_SCAN_DEPTH = 32

/** 目录级主图名（与视频不同名时挂目录条目） */
const DIR_PRIMARY_NAMES: ReadonlySet<string> = new Set(['poster', 'cover', 'folder'])
/** 目录级背景图名（`fanart` / `fanart1` / `fanarts2`… 也按背景图算） */
const DIR_BACKDROP_NAMES: ReadonlySet<string> = new Set(['backdrop', 'background'])
const DIR_FANART_NAMES = /^fanarts?\d*$/
/** 目录级缩略图名（`thumb` / `thumb1` / `thumbs2`…） */
const DIR_THUMB_NAMES = /^thumbs?\d*$/
/** 目录级剧照名（`still` / `still1` / `screenshots2`…） */
const DIR_STILL_NAMES = /^(?:still|screenshot)s?\d*$/
/** 目录级横幅 / 徽标名（Jellyfin 的 Banner / Logo） */
const DIR_BANNER_NAMES: ReadonlySet<string> = new Set(['banner'])
const DIR_LOGO_NAMES: ReadonlySet<string> = new Set(['logo', 'clearlogo'])
/** 剧照 / 缩略图子目录：里面的图片属于**上一层**目录里的影片 */
const EXTRA_ART_DIR_NAMES: ReadonlySet<string> = new Set(['extrafanart', 'extrathumbs'])

/** 图片基础名（去扩展名、小写）→ 用途；不是固定图片名时返回 null */
export function imageTypeOfBaseName(base: string): MediaImageType | null {
  if (DIR_PRIMARY_NAMES.has(base)) return 'primary'
  if (DIR_BACKDROP_NAMES.has(base)) return 'backdrop'
  if (DIR_FANART_NAMES.test(base)) return 'backdrop'
  if (DIR_THUMB_NAMES.test(base)) return 'thumb'
  if (DIR_STILL_NAMES.test(base)) return 'still'
  if (DIR_BANNER_NAMES.has(base)) return 'banner'
  if (DIR_LOGO_NAMES.has(base)) return 'logo'
  return null
}

/**
 * 图片是不是刮削产物名：目录级固定名（`poster.jpg` / `thumb.jpg` / `still1.jpg`…），
 * 或者 `<视频基础名>-<固定名>.jpg`（刮削关掉重命名时的附属文件命名，见 `resolveAssetFile`）。
 *
 * 只有这类图片会被清理（`cleanupUnseen`）；用户自己放的其他图不归扫描管。
 */
export function isScanOwnedImagePath(path: string): boolean {
  const base = stripExtension(basenameRemotePath(path)).toLowerCase()
  if (imageTypeOfBaseName(base) !== null) return true
  const dash = base.lastIndexOf('-')
  return dash > 0 && imageTypeOfBaseName(base.slice(dash + 1)) !== null
}

/** 条目 / 源 / 图片 ID 共用的哈希口径：sha1 前 32 位 */
export function hashId(input: string): string {
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
  /** 只索引体积不小于该值（MB）的视频；0 或省略表示不过滤 */
  minFileSizeMb?: number
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
  /** 剧集库专属：认不出季 / 集号而没入库的视频数 */
  skippedVideos: number
}

/** 新建一份空结果（影片与剧集索引器共用，保证字段齐全） */
export function emptyResult(): IndexPathResult {
  return {
    indexedFiles: 0,
    indexedVideos: 0,
    skippedDirs: 0,
    skippedPaths: [],
    scannedDirs: 0,
    truncated: false,
    seenImages: new Set<string>(),
    skippedVideos: 0
  }
}

export function isCancelled(options: IndexPathOptions): boolean {
  return options.isCancelled?.() === true
}

export function isImageEntry(entry: FileEntry): boolean {
  return mediaSourceKindOf(entry.mime, entry.extname) === 'image'
}

/**
 * 文件是不是影片：拿传入的后缀清单比对。
 *
 * `entry.extname` 通常已经是无点小写，但脏数据可能带点、大写或空白，这里统一清洗后再比。
 */
export function isVideoExtension(extensions: readonly string[], extname: string): boolean {
  const ext = extname.trim().replace(/^\.+/, '').toLowerCase()
  return extensions.includes(ext)
}

/** 把「最小体积（MB）」换算成字节门槛；非法值按不过滤处理 */
export function minBytesOf(minFileSizeMb: number | undefined): number {
  if (minFileSizeMb === undefined || !Number.isFinite(minFileSizeMb) || minFileSizeMb <= 0) return 0
  return minFileSizeMb * 1024 * 1024
}

/** 视频是否达到最小体积；体积未知（0 字节）时放行，避免连接不报 size 就扫不到东西 */
export function isBigEnoughVideo(file: FileEntry, minBytes: number): boolean {
  if (minBytes <= 0) return true
  if (file.size <= 0) return true
  return file.size >= minBytes
}

/**
 * 剧照 / 缩略图子目录（`extrafanart`、`extrathumbs`，以及它们下面一层的 `S1` 这类目录）
 * 里的图片属于上一层目录里的影片，返回那个锚点目录；普通目录返回 null。
 */
export function extraArtAnchor(dirPath: string): string | null {
  if (EXTRA_ART_DIR_NAMES.has(basenameRemotePath(dirPath).toLowerCase())) {
    return dirnameRemotePath(dirPath)
  }
  const parent = dirnameRemotePath(dirPath)
  if (parent !== FILE_ROOT && EXTRA_ART_DIR_NAMES.has(basenameRemotePath(parent).toLowerCase())) {
    return dirnameRemotePath(parent)
  }
  return null
}
