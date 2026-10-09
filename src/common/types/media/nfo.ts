/**
 * NFO 解析：把 Kodi 兼容的 movie.nfo 读回公共形状。
 *
 * 契约：
 * - 纯函数，只用字符串扫描，不引第三方 XML 库，也不导入 `node:*`（本目录三端共享）；
 * - 字段口径与写入侧 `@common/types/scrape/nfo.ts` 的 `buildNfoXml` 对齐；
 * - 没有 `<movie>` 根或所有字段都为空时返回 `null`，绝不抛错。
 */

/** 从 NFO 读回的影片元信息：缺失字段统一给空串 / 0 / 空数组，调用方不必再判 undefined */
export interface MediaNfoMeta {
  title: string
  /** 番号 */
  num: string
  originalTitle: string
  plot: string
  actors: string[]
  maker: string
  label: string
  studio: string
  series: string
  director: string
  releaseDate: string
  /** 时长（分钟），0 表示未知 */
  duration: number
  tags: string[]
}

/** 整个值包在 CDATA 里的写法，部分第三方 NFO 工具会这么写 */
const CDATA_WRAPPER = /^<!\[CDATA\[([\s\S]*?)\]\]>$/

/** 解码 XML 实体：`&amp;` 必须最后处理，否则 `&amp;lt;` 会被二次解码 */
function decodeXmlText(value: string): string {
  const trimmed = value.trim()
  const cdata = CDATA_WRAPPER.exec(trimmed)
  return (cdata?.[1] ?? trimmed)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
}

/** 取第一个 `<name>…</name>` 的文本，取不到返回空串 */
function firstTag(xml: string, name: string): string {
  const matched = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml)
  return matched ? decodeXmlText(matched[1] ?? '') : ''
}

/** 取所有同名标签的文本，空值直接丢掉 */
function allTags(xml: string, name: string): string[] {
  const pattern = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'gi')
  const values: string[] = []
  for (const matched of xml.matchAll(pattern)) {
    const text = decodeXmlText(matched[1] ?? '')
    if (text.length > 0) values.push(text)
  }
  return values
}

/** 时长只取开头的整数，容忍 `90` / `90.0` / `90 min` 这类写法 */
function durationOf(xml: string): number {
  const value = Number.parseInt(firstTag(xml, 'runtime'), 10)
  return Number.isFinite(value) && value > 0 ? value : 0
}

/** 有没有解析到任何有效字段：全空视为这不是一份能用的 NFO */
function hasContent(meta: MediaNfoMeta): boolean {
  return (
    meta.title.length > 0 ||
    meta.num.length > 0 ||
    meta.originalTitle.length > 0 ||
    meta.plot.length > 0 ||
    meta.actors.length > 0 ||
    meta.maker.length > 0 ||
    meta.label.length > 0 ||
    meta.studio.length > 0 ||
    meta.series.length > 0 ||
    meta.director.length > 0 ||
    meta.releaseDate.length > 0 ||
    meta.duration > 0 ||
    meta.tags.length > 0
  )
}

export function parseNfoXml(xml: string): MediaNfoMeta | null {
  if (!/<movie\b/i.test(xml)) return null
  const meta: MediaNfoMeta = {
    title: firstTag(xml, 'title'),
    num: firstTag(xml, 'num'),
    originalTitle: firstTag(xml, 'originaltitle'),
    plot: firstTag(xml, 'plot'),
    actors: allTags(xml, 'actor')
      .map((block) => firstTag(block, 'name'))
      .filter((name) => name.length > 0),
    maker: firstTag(xml, 'maker'),
    label: firstTag(xml, 'label'),
    studio: firstTag(xml, 'studio'),
    series: firstTag(xml, 'series'),
    director: firstTag(xml, 'director'),
    releaseDate: firstTag(xml, 'premiered') || firstTag(xml, 'releaseDate'),
    duration: durationOf(xml),
    tags: allTags(xml, 'tag')
  }
  return hasContent(meta) ? meta : null
}
