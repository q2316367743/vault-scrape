/**
 * NFO 解析：把 Kodi / Jellyfin 兼容的 NFO 读回公共形状。
 *
 * 契约：
 * - 纯函数，只用字符串扫描，不引第三方 XML 库，也不导入 `node:*`（本目录三端共享）；
 * - 字段口径与写入侧 `@common/types/scrape/nfo.ts` / `tvNfo.ts` 的 `build*NfoXml` 对齐；
 * - 按**根元素**分派 `kind`：`<movie>` / `<tvshow>` / `<season>` / `<episodedetails>`
 *   （`<episode>` 也认成 `<episodedetails>`）；一个都不认识或所有字段都为空时返回 `null`，绝不抛错；
 * - 剧集库的 `tvshow.nfo`、季的 `season.nfo`、集的 `<集名>.nfo` 都靠这条分派才能读出来；
 * - `parseNfoRestore` 只认本宿主写下的「刮削前位置」私有标签（`<originalfilename>` /
 *   `<originaldirectory>` / `<plantedfile>`），别的工具写的 NFO 一律返回 `null`。
 */

import type { NfoRestoreFile, NfoRestoreInfo } from '../scrape/nfo'

export type { NfoRestoreFile, NfoRestoreInfo } from '../scrape/nfo'

/** NFO 的根元素种类 */
export type NfoKind = 'movie' | 'tvshow' | 'season' | 'episode'

/** 从 NFO 读回的元信息：缺失字段统一给空串 / 0 / 空数组 / null，调用方不必再判 undefined */
export interface MediaNfoMeta {
  /** 根元素决定的种类；调用方按它判断这份 NFO 是不是自己要的那一层 */
  kind: NfoKind
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
  /** 年份（`<year>`，没有就取 `<premiered>` / `<aired>` 的前四位），没有为空串 */
  year: string
  /** 题材（`<genre>`） */
  genres: string[]
  /** 季号（`<seasonnumber>` / `<season>`），没有为 null */
  seasonNumber: number | null
  /** 集号（`<episode>`），没有为 null */
  episodeNumber: number | null
  /** 剧集名（`<showtitle>`，集 NFO 用），没有为空串 */
  showTitle: string
  /** 外部 ID（`<uniqueid type="tmdb">27205</uniqueid>`），没有为空对象 */
  providerIds: Record<string, string>
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
    meta.tags.length > 0 ||
    meta.year.length > 0 ||
    meta.genres.length > 0 ||
    meta.seasonNumber !== null ||
    meta.episodeNumber !== null ||
    meta.showTitle.length > 0 ||
    Object.keys(meta.providerIds).length > 0
  )
}

/**
 * 根元素种类：认文档里第一个出现的已知根标签。
 *
 * 用「第一个出现的」而不是「最外层」：本解析器只做字符串扫描，不做嵌套校验，
 * 而写入侧四种 NFO 的根标签一定在自己文档里最先出现，够用且不会误判子标签
 * （`<episodedetails>` 里的 `<episode>` 排在它后面）。
 */
function rootKindOf(xml: string): NfoKind | null {
  const matched = /<\s*(movie|tvshow|episodedetails|episode|season)\b/i.exec(xml)
  if (!matched) return null
  const name = (matched[1] ?? '').toLowerCase()
  if (name === 'movie') return 'movie'
  if (name === 'tvshow') return 'tvshow'
  if (name === 'season') return 'season'
  return 'episode'
}

/** 取第一个 `<name>` 里的非负整数（季号 / 集号可以是 0），取不到返回 null */
function numberTagOf(xml: string, name: string): number | null {
  const value = Number.parseInt(firstTag(xml, name), 10)
  return Number.isFinite(value) && value >= 0 ? value : null
}

/** `<uniqueid type="tmdb" default="true">27205</uniqueid>` → `{ tmdb: '27205' }` */
function uniqueIdsOf(xml: string): Record<string, string> {
  const ids: Record<string, string> = {}
  for (const item of allTagMatches(xml, 'uniqueid')) {
    const key = attrOf(item.attrs, 'type').trim().toLowerCase()
    const value = item.value.trim()
    if (key.length === 0 || value.length === 0 || ids[key] !== undefined) continue
    ids[key] = value
  }
  return ids
}

export function parseNfoXml(xml: string): MediaNfoMeta | null {
  const kind = rootKindOf(xml)
  if (kind === null) return null
  const releaseDate =
    firstTag(xml, 'premiered') || firstTag(xml, 'aired') || firstTag(xml, 'releaseDate')
  const meta: MediaNfoMeta = {
    kind,
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
    releaseDate,
    duration: durationOf(xml),
    tags: allTags(xml, 'tag'),
    year: firstTag(xml, 'year') || (/(?:19|20)\d{2}/.exec(releaseDate)?.[0] ?? ''),
    genres: allTags(xml, 'genre'),
    seasonNumber: numberTagOf(xml, 'seasonnumber') ?? numberTagOf(xml, 'season'),
    episodeNumber: numberTagOf(xml, 'episode'),
    showTitle: firstTag(xml, 'showtitle'),
    providerIds: uniqueIdsOf(xml)
  }
  return hasContent(meta) ? meta : null
}

/**
 * 取所有 `<name … />`（自闭合）或 `<name …>…</name>` 标签的属性原文与文本。
 *
 * 与 `allTags` 分开：`allTags` 的口径是「有内容的成对标签」，行为不能动；
 * 还原记录里的 `<plantedfile>` 是自闭合的，需要额外认这一种写法。
 */
function allTagMatches(xml: string, name: string): { attrs: string; value: string }[] {
  const pattern = new RegExp(`<${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${name}>)`, 'gi')
  const values: { attrs: string; value: string }[] = []
  for (const matched of xml.matchAll(pattern)) {
    values.push({ attrs: matched[1] ?? '', value: decodeXmlText(matched[2] ?? '') })
  }
  return values
}

/** 取标签属性原文里的一个属性值，取不到返回空串 */
function attrOf(attrs: string, name: string): string {
  const matched = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs)
  return matched ? decodeXmlText(matched[1] ?? '') : ''
}

/** 相对影片目录的路径：非空、相对、路径段不含空段 / `.` / `..`，否则 `null` */
function safeRelativePath(value: string): string | null {
  const relative = value.trim()
  if (relative.length === 0 || relative.startsWith('/')) return null
  const segments = relative.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null
  return relative
}

/** 连接内绝对路径：`/` 开头、路径段不含 `.` / `..`，否则空串（＝这条记录不可用） */
function safeRemotePath(value: string): string {
  const path = value.trim()
  if (!path.startsWith('/')) return ''
  if (path.split('/').some((segment) => segment === '.' || segment === '..')) return ''
  return path
}

/** 视频文件名：非空、不含路径分隔符、不是 `.` / `..`，否则空串 */
function safeFileName(value: string): string {
  const name = value.trim()
  if (name.length === 0 || name === '.' || name === '..') return ''
  if (name.includes('/') || name.includes('\\')) return ''
  return name
}

/**
 * 读回「刮削前位置」还原记录；没有记录 / 记录不可用时返回 `null`（调用方退化成只清数据）。
 *
 * 磁盘上的 NFO 可能是旧版本写的、第三方工具写的、甚至被人手改过，这里一律当作不可信输入：
 * 路径不合法就丢掉条目，整条记录不合法就返回 `null`，绝不抛错。
 */
export function parseNfoRestore(xml: string): NfoRestoreInfo | null {
  const fileName = safeFileName(firstTag(xml, 'originalfilename'))
  const directory = safeRemotePath(firstTag(xml, 'originaldirectory'))
  if (fileName.length === 0 || directory.length === 0) return null
  const files: NfoRestoreFile[] = []
  for (const matched of allTagMatches(xml, 'plantedfile')) {
    const relativePath = safeRelativePath(attrOf(matched.attrs, 'relative'))
    if (relativePath === null) continue
    files.push({ relativePath, origin: safeRemotePath(attrOf(matched.attrs, 'original')) })
  }
  return { fileName, directory, files }
}
