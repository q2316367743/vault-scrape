import { readBoolean, readEnum, readNumber, readString, toSource } from './shared'

/** 附属文件（海报 / 横版缩略图 / 背景图 / 预告片）的文件名规则 */
export type AssetNaming = 'fixed' | 'movie'

export const ASSET_NAMINGS: readonly AssetNaming[] = ['fixed', 'movie']

/** 分盘样式 */
export type PartStyle = 'origin' | 'cd' | 'part' | 'disc'

export const PART_STYLES: readonly PartStyle[] = ['origin', 'cd', 'part', 'disc']

/**
 * 命名规则设置。
 *
 * 契约：影片文件夹名、视频文件名、NFO 文件名**同源同值**，都由 `fileTemplate` 渲染，
 * 因此这里没有独立的文件夹模板（见 docs/scrape/01-scrape-module.md 的目录规范）。
 */
export interface SettingNaming {
  /** 名称模板：文件夹名 / 视频文件名 / NFO 文件名三者共用一个结果 */
  fileTemplate: string
  /** 附属文件命名：固定命名 / 跟随影片文件名 */
  assetNaming: AssetNaming
  /** NFO 标题模板 */
  nfoTitleTemplate: string
  /** 演员名最大数量 */
  actorMaxCount: number
  /** 演员名超出后缀，支持 {count} 占位符 */
  actorOverflowSuffix: string
  /** 演员为空时使用片商或卖家 */
  actorFallbackToMaker: boolean
  /** 发行日期格式（dayjs 格式串） */
  releaseDateFormat: string
  /** 分盘样式 */
  partStyle: PartStyle
  /** 名称最大长度（文件夹名与文件名同源，共用这一个上限） */
  fileNameMaxLength: number
  /** 中文字幕标记 */
  chinaSubtitleTag: string
  /** UMR 标记 */
  umrTag: string
  /** 流出标记 */
  leakTag: string
  /** 无码标记 */
  uncensoredTag: string
  /** 有码标记 */
  censoredTag: string
}

export function buildSettingNaming(): SettingNaming {
  return {
    fileTemplate: '{num} {title} ({year}) [{providerId}]',
    assetNaming: 'fixed',
    nfoTitleTemplate: '{num} {title}',
    actorMaxCount: 5,
    actorOverflowSuffix: '等{count}人',
    actorFallbackToMaker: false,
    releaseDateFormat: 'YYYY-MM-DD',
    partStyle: 'origin',
    fileNameMaxLength: 120,
    chinaSubtitleTag: '中文字幕',
    umrTag: 'UMR',
    leakTag: '流出',
    uncensoredTag: '无码',
    censoredTag: '有码'
  }
}

export function normalizeSettingNaming(raw: unknown): SettingNaming {
  const base = buildSettingNaming()
  const source = toSource(raw)
  if (!source) return base
  return {
    fileTemplate: readString(source, 'fileTemplate', base.fileTemplate),
    assetNaming: readEnum(source, 'assetNaming', ASSET_NAMINGS, base.assetNaming),
    nfoTitleTemplate: readString(source, 'nfoTitleTemplate', base.nfoTitleTemplate),
    actorMaxCount: readNumber(source, 'actorMaxCount', base.actorMaxCount, 1),
    actorOverflowSuffix: readString(source, 'actorOverflowSuffix', base.actorOverflowSuffix),
    actorFallbackToMaker: readBoolean(source, 'actorFallbackToMaker', base.actorFallbackToMaker),
    releaseDateFormat: readString(source, 'releaseDateFormat', base.releaseDateFormat),
    partStyle: readEnum(source, 'partStyle', PART_STYLES, base.partStyle),
    fileNameMaxLength: readNumber(source, 'fileNameMaxLength', base.fileNameMaxLength, 1),
    chinaSubtitleTag: readString(source, 'chinaSubtitleTag', base.chinaSubtitleTag),
    umrTag: readString(source, 'umrTag', base.umrTag),
    leakTag: readString(source, 'leakTag', base.leakTag),
    uncensoredTag: readString(source, 'uncensoredTag', base.uncensoredTag),
    censoredTag: readString(source, 'censoredTag', base.censoredTag)
  }
}
