/**
 * NFO 生成：把插件详情渲染成 Kodi 兼容的 movie.nfo。
 *
 * 契约：
 * - 纯函数，缺失字段直接省略标签，绝不写空标签；
 * - 标题使用 `naming.nfoTitleTemplate` 渲染，渲染为空时回落详情标题；
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

/** 生成 NFO 文本（以换行结尾） */
export function buildNfoXml(detail: PluginMovieDetail, naming: SettingNaming): string {
  const rows: string[] = []
  const push = (name: string, value?: string): void => {
    const text = (value ?? '').trim()
    if (text.length === 0) return
    rows.push(`  <${name}>${escapeXml(text)}</${name}>`)
  }

  const title = renderTemplate(naming.nfoTitleTemplate, detail, naming) || (detail.title ?? '').trim()
  push('title', title)
  push('originaltitle', detail.originalTitle)
  push('num', detail.num)
  push('plot', detail.plot)

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
