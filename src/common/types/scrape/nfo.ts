/**
 * NFO 生成：把插件详情渲染成 Kodi 兼容的 movie.nfo。
 *
 * 契约：
 * - 纯函数，缺失字段直接省略标签，绝不写空标签；
 * - 标题使用 `naming.nfoTitleTemplate` 渲染，渲染为空时回落详情标题；
 * - 图片写**相对影片目录**的文件名（`poster.jpg` / `extrafanart/fanart1.jpg`），
 *   与目录规范一一对应，读回本地时不需要任何路径换算；
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

const NFO_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

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

/** 生成 NFO 文本（以换行结尾） */
export function buildNfoXml(
  detail: PluginMovieDetail,
  naming: SettingNaming,
  artwork: NfoArtwork = {}
): string {
  const rows: string[] = []
  const push = (name: string, value?: string): void => {
    const text = (value ?? '').trim()
    if (text.length === 0) return
    rows.push(`  <${name}>${escapeXml(text)}</${name}>`)
  }
  const pushArt = (name: string, value: string | undefined, aspect?: string): void => {
    const text = (value ?? '').trim()
    if (text.length === 0) return
    const attribute = aspect === undefined ? '' : ` aspect="${aspect}"`
    rows.push(`  <${name}${attribute}>${escapeXml(text)}</${name}>`)
  }

  const title = renderTemplate(naming.nfoTitleTemplate, detail, naming) || (detail.title ?? '').trim()
  push('title', title)
  push('originaltitle', detail.originalTitle)
  push('num', detail.num)
  push('plot', detail.plot)

  pushArt('thumb', artwork.poster, 'poster')
  pushArt('thumb', artwork.thumb, 'landscape')
  pushArt('banner', artwork.banner)
  pushArt('logo', artwork.logo)

  const fanart = [artwork.backdrop ?? '', ...(artwork.stills ?? [])]
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  if (fanart.length > 0) {
    rows.push('  <fanart>')
    for (const item of fanart) rows.push(`    <thumb>${escapeXml(item)}</thumb>`)
    rows.push('  </fanart>')
  }

  const actors = (detail.actors ?? []).map((item) => item.trim()).filter((item) => item.length > 0)
  for (const actor of actors) {
    rows.push('  <actor>')
    rows.push(`    <name>${escapeXml(actor)}</name>`)
    rows.push('  </actor>')
  }

  push('maker', detail.maker)
  push('label', detail.label)
  push('studio', detail.studio)
  push('series', detail.series)
  push('director', detail.director)

  const date = formatReleaseDate(detail, naming)
  push('premiered', date)
  push('releaseDate', date)

  if (typeof detail.duration === 'number' && detail.duration > 0) {
    push('runtime', String(detail.duration))
  }
  for (const tag of detail.tags ?? []) push('tag', tag)
  if (detail.episodes && detail.episodes.length > 0) {
    push('episodeCount', String(detail.episodes.length))
  }

  return `${NFO_DECLARATION}\n<movie>\n${rows.join('\n')}\n</movie>\n`
}
