import { readBoolean, readEnum, readStringArray, toSource } from './shared'

/** 封面角标位置 */
export type BadgeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export const BADGE_CORNERS: readonly BadgeCorner[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right'
]

/** NFO 文件命名方式 */
export type NfoFileNaming = 'both' | 'movie' | 'filename'

export const NFO_FILE_NAMINGS: readonly NfoFileNaming[] = ['both', 'movie', 'filename']

/** 下载选项 */
export interface SettingDownload {
  /** 下载横版缩略图 */
  downloadThumb: boolean
  /** 下载海报 */
  downloadPoster: boolean
  /** 为封面添加标签角标 */
  posterTagBadge: boolean
  /** 角标启用的标签类型 */
  posterBadgeTypes: string[]
  /** 角标位置 */
  posterBadgeCorner: BadgeCorner
  /** 下载背景图 */
  downloadFanart: boolean
  /** 下载剧照 */
  downloadStill: boolean
  /** 下载预告片 */
  downloadTrailer: boolean
  /** 保留已有横版缩略图 */
  keepThumb: boolean
  /** 保留已有海报 */
  keepPoster: boolean
  /** 保留已有背景图 */
  keepFanart: boolean
  /** 保留已有剧照 */
  keepStill: boolean
  /** 保留已有预告片 */
  keepTrailer: boolean
  /** 生成 NFO */
  generateNfo: boolean
  /** NFO 文件命名 */
  nfoFileNaming: NfoFileNaming
  /** 保留已有 NFO */
  keepNfo: boolean
}

export function buildSettingDownload(): SettingDownload {
  return {
    downloadThumb: true,
    downloadPoster: true,
    posterTagBadge: false,
    posterBadgeTypes: [],
    posterBadgeCorner: 'top-right',
    downloadFanart: true,
    downloadStill: true,
    downloadTrailer: true,
    keepThumb: true,
    keepPoster: true,
    keepFanart: true,
    keepStill: true,
    keepTrailer: true,
    generateNfo: true,
    nfoFileNaming: 'both',
    keepNfo: true
  }
}

export function normalizeSettingDownload(raw: unknown): SettingDownload {
  const base = buildSettingDownload()
  const source = toSource(raw)
  if (!source) return base
  return {
    downloadThumb: readBoolean(source, 'downloadThumb', base.downloadThumb),
    downloadPoster: readBoolean(source, 'downloadPoster', base.downloadPoster),
    posterTagBadge: readBoolean(source, 'posterTagBadge', base.posterTagBadge),
    posterBadgeTypes: readStringArray(source, 'posterBadgeTypes', base.posterBadgeTypes),
    posterBadgeCorner: readEnum(source, 'posterBadgeCorner', BADGE_CORNERS, base.posterBadgeCorner),
    downloadFanart: readBoolean(source, 'downloadFanart', base.downloadFanart),
    downloadStill: readBoolean(source, 'downloadStill', base.downloadStill),
    downloadTrailer: readBoolean(source, 'downloadTrailer', base.downloadTrailer),
    keepThumb: readBoolean(source, 'keepThumb', base.keepThumb),
    keepPoster: readBoolean(source, 'keepPoster', base.keepPoster),
    keepFanart: readBoolean(source, 'keepFanart', base.keepFanart),
    keepStill: readBoolean(source, 'keepStill', base.keepStill),
    keepTrailer: readBoolean(source, 'keepTrailer', base.keepTrailer),
    generateNfo: readBoolean(source, 'generateNfo', base.generateNfo),
    nfoFileNaming: readEnum(source, 'nfoFileNaming', NFO_FILE_NAMINGS, base.nfoFileNaming),
    keepNfo: readBoolean(source, 'keepNfo', base.keepNfo)
  }
}
