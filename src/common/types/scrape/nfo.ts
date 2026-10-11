/**
 * NFO 生成：把插件详情渲染成 Kodi 兼容的 movie.nfo。
 *
 * 契约：
 * - 纯函数，缺失字段直接省略标签，绝不写空标签；
 * - 标题使用 `naming.nfoTitleTemplate` 渲染，渲染为空时回落详情标题；
 * - 图片写**相对影片目录**的文件名（`poster.jpg` / `extrafanart/fanart1.jpg`），
 *   与目录规范一一对应，读回本地时不需要任何路径换算；
 * - 「刮削前位置」写在 `<originalfilename>` / `<originaldirectory>` / `<plantedfile>`
 *   私有标签里，只由本宿主读回（读侧见 `@common/types/media` 的 `parseNfoRestore`）；
 * - 只做 XML 转义，不做任何网络/文件操作。
 */
import type { PluginMovieDetail } from '../plugin'
import type { SettingNaming } from '../setting'
import { formatReleaseDate, renderTemplate } from './naming'

const AMPERSAND_PATTERN = /&/g
const LESS_PATTERN = /</g
const GREATER_PATTERN = />/g
const QUOTE_PATTERN = /"/g
const APOSTROPHE_PATTERN = /'/g

export function escapeXml(value: string): string {
  return value
    .replace(AMPERSAND_PATTERN, '&amp;')
    .replace(LESS_PATTERN, '&lt;')
    .replace(GREATER_PATTERN, '&gt;')
    .replace(QUOTE_PATTERN, '&quot;')
    .replace(APOSTROPHE_PATTERN, '&apos;')
}

export const NFO_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

/** 追加一个非空标签；值为空白时整行省略（绝不写空标签） */
export function pushNfoTag(rows: string[], name: string, value?: string): void {
  const text = (value ?? '').trim()
  if (text.length === 0) return
  rows.push(`  <${name}>${escapeXml(text)}</${name}>`)
}

/** 追加一个非空资源标签，可带 `aspect` 属性（`<thumb aspect="poster">`） */
export function pushNfoArtTag(
  rows: string[],
  name: string,
  value: string | undefined,
  aspect?: string
): void {
  const text = (value ?? '').trim()
  if (text.length === 0) return
  const attribute = aspect === undefined ? '' : ` aspect="${aspect}"`
  rows.push(`  <${name}${attribute}>${escapeXml(text)}</${name}>`)
}

/** 追加 `<fanart>` 块（背景图 + 额外剧照），全部为空时整块不写 */
export function pushNfoFanart(rows: string[], items: readonly (string | undefined)[]): void {
  const fanart = items.map((item) => (item ?? '').trim()).filter((item) => item.length > 0)
  if (fanart.length === 0) return
  rows.push('  <fanart>')
  for (const item of fanart) rows.push(`    <thumb>${escapeXml(item)}</thumb>`)
  rows.push('  </fanart>')
}

/** 追加 `<actor>` 块（只有姓名） */
export function pushNfoActors(rows: string[], actors: readonly string[] | undefined): void {
  const names = (actors ?? []).map((item) => item.trim()).filter((item) => item.length > 0)
  for (const name of names) {
    rows.push('  <actor>')
    rows.push(`    <name>${escapeXml(name)}</name>`)
    rows.push('  </actor>')
  }
}

/** NFO 里要写的图片：值都是相对影片目录的路径 */
export interface NfoArtwork {
  /** 主图（`poster.jpg`），写成 `<thumb>` */
  poster?: string
  /** 横版缩略图（`thumb.jpg`），写成 `<thumb aspect="landscape">` */
  thumb?: string
  /** 背景图（`backdrop.jpg`）与额外剧照，写成 `<fanart>` 下的 `<thumb>` */
  backdrop?: string
  /** 额外剧照（`extrafanart/fanart1.jpg`…） */
  stills?: readonly string[]
  /** 横幅（`banner.jpg`） */
  banner?: string
  /** 徽标（`logo.png`） */
  logo?: string
}

/** 刮削就位的附属文件：清除 NFO 时按 `origin` 决定搬回还是删掉 */
export interface NfoRestoreFile {
  /** 相对影片目录的路径（`poster.jpg` / `extrafanart/fanart1.jpg`），与 `NfoArtwork` 同口径 */
  relativePath: string
  /** 本地沿用的图片刮削前的位置（连接内绝对路径）；联网下载的为空串（直接删） */
  origin: string
}

/** 「刮削前位置」还原记录：写在 NFO 里，清除 NFO 时据此把视频改回名、移回原目录 */
export interface NfoRestoreInfo {
  /** 刮削前的视频文件名（含扩展名） */
  fileName: string
  /** 刮削前的视频所在目录（连接内绝对路径） */
  directory: string
  files: readonly NfoRestoreFile[]
}

/**
 * 追加宿主私有的还原记录（Kodi / Jellyfin 会忽略未知标签）。
 *
 * 记录不全（缺文件名或缺目录）时整块不写：宁可没有记录、退化成「只清数据」，
 * 也不留一份还原不回去的半截数据。
 */
export function appendRestore(rows: string[], restore: NfoRestoreInfo): void {
  const fileName = restore.fileName.trim()
  const directory = restore.directory.trim()
  if (fileName.length === 0 || directory.length === 0) return
  rows.push('  <!-- vault-scrape 还原记录：清除 NFO 时按此还原，其它工具可忽略 -->')
  rows.push(`  <originalfilename>${escapeXml(fileName)}</originalfilename>`)
  rows.push(`  <originaldirectory>${escapeXml(directory)}</originaldirectory>`)
  for (const file of restore.files) {
    const relativePath = file.relativePath.trim()
    if (relativePath.length === 0) continue
    const origin = file.origin.trim()
    const attribute = origin.length === 0 ? '' : ` original="${escapeXml(origin)}"`
    rows.push(`  <plantedfile relative="${escapeXml(relativePath)}"${attribute} />`)
  }
}

/** 生成 NFO 文本（以换行结尾）；`restore` 为空时与旧版本完全一致 */
export function buildNfoXml(
  detail: PluginMovieDetail,
  naming: SettingNaming,
  artwork: NfoArtwork = {},
  restore: NfoRestoreInfo | null = null
): string {
  const rows: string[] = []
  const push = pushNfoTag
  const pushArt = pushNfoArtTag

  const title = renderTemplate(naming.nfoTitleTemplate, detail, naming) || (detail.title ?? '').trim()
  push(rows, 'title', title)
  push(rows, 'originaltitle', detail.originalTitle)
  push(rows, 'num', detail.num)
  push(rows, 'plot', detail.plot)

  pushArt(rows, 'thumb', artwork.poster, 'poster')
  pushArt(rows, 'thumb', artwork.thumb, 'landscape')
  pushArt(rows, 'banner', artwork.banner)
  pushArt(rows, 'logo', artwork.logo)

  pushNfoFanart(rows, [artwork.backdrop, ...(artwork.stills ?? [])])

  pushNfoActors(rows, detail.actors)

  push(rows, 'maker', detail.maker)
  push(rows, 'label', detail.label)
  push(rows, 'studio', detail.studio)
  push(rows, 'series', detail.series)
  push(rows, 'director', detail.director)

  const date = formatReleaseDate(detail, naming)
  push(rows, 'premiered', date)
  push(rows, 'releaseDate', date)

  if (typeof detail.duration === 'number' && detail.duration > 0) {
    push(rows, 'runtime', String(detail.duration))
  }
  for (const tag of detail.tags ?? []) push(rows, 'tag', tag)
  if (detail.episodes && detail.episodes.length > 0) {
    push(rows, 'episodeCount', String(detail.episodes.length))
  }

  if (restore) appendRestore(rows, restore)

  return `${NFO_DECLARATION}\n<movie>\n${rows.join('\n')}\n</movie>\n`
}
