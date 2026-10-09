/**
 * 离线库行 → 插件契约（PluginMovieCandidate / PluginMovieDetail / PluginAsset）的纯映射。
 *
 * 契约：
 * 1. 列名以 r18.dev dump 的 `derived_video` 为准（2026-10-06 版）：
 *    content_id, dvd_id, title_en, title_ja, comment_en, comment_ja, runtime_mins, release_date,
 *    sample_url, maker_id, label_id, series_id, jacket_full_url, jacket_thumb_url,
 *    gallery_full_first, gallery_full_last, gallery_thumb_first, gallery_thumb_last, site_id, service_code；
 * 2. 图片字段存的是**相对路径**（如 `digital/video/100tv00031/100tv00031pl`），
 *    需拼成 `https://pics.dmm.co.jp/<path>.jpg`，且 DMM 要求 Referer；
 * 3. 缺失值一律回落空串 / undefined，不抛错（保底方案要求「有多少给多少」）。
 */
import type { PluginAsset, PluginMovieCandidate, PluginMovieDetail } from '@common/types/plugin'

export const DMM_IMAGE_BASE = 'https://pics.dmm.co.jp/'
export const DMM_REFERER = 'https://www.dmm.co.jp/'

/** 剧照数量上限（避免一次返回几百张） */
export const OFFLINE_STILL_LIMIT = 30

export type OfflineRow = Record<string, unknown>

export function asRow(raw: unknown): OfflineRow {
  return typeof raw === 'object' && raw !== null ? (raw as OfflineRow) : {}
}

/** 宽容读取：数据库里可能是 TEXT 也可能是 INTEGER（亲和性不同），统一成字符串 */
export function readText(source: OfflineRow, key: string): string {
  const value = source[key]
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

export function readNumberValue(source: OfflineRow, key: string): number {
  const raw = readText(source, key)
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) ? value : 0
}

/** derived_video 中我们真正用到的一行 */
export interface OfflineVideoRow {
  contentId: string
  dvdId: string
  titleJa: string
  titleEn: string
  commentJa: string
  commentEn: string
  runtimeMins: number
  releaseDate: string
  makerId: string
  labelId: string
  seriesId: string
  jacketFull: string
  jacketThumb: string
  galleryFullFirst: string
  galleryFullLast: string
  siteId: string
  serviceCode: string
}

export function readVideoRow(raw: unknown): OfflineVideoRow {
  const source = asRow(raw)
  return {
    contentId: readText(source, 'content_id'),
    dvdId: readText(source, 'dvd_id'),
    titleJa: readText(source, 'title_ja'),
    titleEn: readText(source, 'title_en'),
    commentJa: readText(source, 'comment_ja'),
    commentEn: readText(source, 'comment_en'),
    runtimeMins: readNumberValue(source, 'runtime_mins'),
    releaseDate: readText(source, 'release_date'),
    makerId: readText(source, 'maker_id'),
    labelId: readText(source, 'label_id'),
    seriesId: readText(source, 'series_id'),
    jacketFull: readText(source, 'jacket_full_url'),
    jacketThumb: readText(source, 'jacket_thumb_url'),
    galleryFullFirst: readText(source, 'gallery_full_first'),
    galleryFullLast: readText(source, 'gallery_full_last'),
    siteId: readText(source, 'site_id'),
    serviceCode: readText(source, 'service_code')
  }
}

/** 同一作品可能有多行（不同站点 / 服务），按信息完整度打分挑最好的那行 */
export function scoreVideoRow(row: OfflineVideoRow): number {
  let score = 0
  if (row.titleJa.length > 0) score += 8
  if (row.jacketFull.length > 0) score += 4
  if (row.titleEn.length > 0) score += 2
  if (row.commentJa.length > 0 || row.commentEn.length > 0) score += 1
  if (row.serviceCode === 'digital') score += 3
  else if (row.serviceCode === 'mono') score += 2
  else if (row.serviceCode === 'rental') score += 1
  return score
}

export function pickBestRow(rows: readonly OfflineVideoRow[]): OfflineVideoRow | null {
  let best: OfflineVideoRow | null = null
  let bestScore = -1
  for (const row of rows) {
    const score = scoreVideoRow(row)
    if (score > bestScore) {
      best = row
      bestScore = score
    }
  }
  return best
}

/** 番号归一化：大写 + 去掉空白与连字符，对齐库里的 dvd_id_norm 生成列 */
export function normalizeNum(value: string): string {
  return value.trim().toUpperCase().replace(/[\s\-_]/g, '')
}

/** content_id 归一化：小写 + 去掉空白 */
export function normalizeContentId(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

/** 相对路径 → DMM CDN 绝对地址；已是绝对地址则原样返回 */
export function picUrl(path: string): string {
  const value = path.trim()
  if (value.length === 0) return ''
  if (/^https?:\/\//i.test(value)) return value
  const normalized = value.replace(/^\/+/, '')
  return /\.(jpg|jpeg|png|webp)$/i.test(normalized)
    ? `${DMM_IMAGE_BASE}${normalized}`
    : `${DMM_IMAGE_BASE}${normalized}.jpg`
}

/** DMM 图片防盗链所需的请求头 */
function imageHeaders(): Record<string, string> {
  return { Referer: DMM_REFERER }
}

/** 由 gallery 首尾相对路径推导全部剧照地址；无法推导时退化为单张 */
export function galleryUrls(first: string, last: string, limit = OFFLINE_STILL_LIMIT): string[] {
  if (first.length === 0) return []
  const tail = last.length > 0 ? last : first
  const firstMatch = /^(.*?)(\d+)$/.exec(first)
  const lastMatch = /^(.*?)(\d+)$/.exec(tail)
  if (!firstMatch || !lastMatch || firstMatch[1] !== lastMatch[1]) return [picUrl(first)]
  const start = Number.parseInt(firstMatch[2], 10)
  const end = Number.parseInt(lastMatch[2], 10)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [picUrl(first)]
  const urls: string[] = []
  for (let index = start; index <= end && urls.length < limit; index += 1) {
    urls.push(picUrl(`${firstMatch[1]}${index}`))
  }
  return urls
}

export function toCandidate(row: OfflineVideoRow): PluginMovieCandidate {
  const title = row.titleJa || row.titleEn || row.dvdId || row.contentId
  const cover = picUrl(row.jacketFull)
  return {
    id: row.contentId,
    title,
    num: row.dvdId || undefined,
    cover: cover.length > 0 ? cover : undefined,
    date: row.releaseDate || undefined
  }
}

/** detail 需要的外部引用（字典表 join 的结果） */
export interface OfflineDetailRefs {
  actresses: string[]
  categories: string[]
  directors: string[]
  maker: string
  label: string
  series: string
  site: string
}

export function emptyDetailRefs(): OfflineDetailRefs {
  return { actresses: [], categories: [], directors: [], maker: '', label: '', series: '', site: '' }
}

export function toDetail(row: OfflineVideoRow, refs: OfflineDetailRefs): PluginMovieDetail {
  const title = row.titleJa || row.titleEn || row.dvdId || row.contentId
  const originalTitle = row.titleEn.length > 0 && row.titleEn !== title ? row.titleEn : undefined
  return {
    id: row.contentId,
    title,
    num: row.dvdId || undefined,
    originalTitle,
    plot: row.commentJa || row.commentEn || '',
    actors: [...refs.actresses],
    maker: refs.maker || undefined,
    label: refs.label || undefined,
    studio: refs.site || undefined,
    series: refs.series || undefined,
    director: refs.directors.length > 0 ? refs.directors.join(' / ') : undefined,
    releaseDate: row.releaseDate || undefined,
    duration: row.runtimeMins > 0 ? row.runtimeMins : undefined,
    tags: [...refs.categories],
    episodes: []
  }
}

/** 封面类资源：poster / thumb 来自 jacket，fanart 退化为首张剧照 */
export function coverAssets(row: OfflineVideoRow): PluginAsset[] {
  const assets: PluginAsset[] = []
  const poster = picUrl(row.jacketFull)
  const thumb = picUrl(row.jacketThumb)
  const fanart = picUrl(row.galleryFullFirst)
  if (poster.length > 0) assets.push({ kind: 'poster', url: poster, headers: imageHeaders() })
  if (thumb.length > 0) assets.push({ kind: 'thumb', url: thumb, headers: imageHeaders() })
  if (fanart.length > 0) assets.push({ kind: 'fanart', url: fanart, headers: imageHeaders() })
  return assets
}

/** 扩展资源：still 来自 gallery，trailer 来自 source_dmm_trailer */
export function extraAssets(row: OfflineVideoRow, trailers: readonly string[]): PluginAsset[] {
  const assets: PluginAsset[] = []
  const stills = galleryUrls(row.galleryFullFirst, row.galleryFullLast)
  stills.forEach((url, index) => {
    assets.push({
      kind: 'still',
      url,
      headers: imageHeaders(),
      name: `still-${String(index + 1).padStart(2, '0')}`
    })
  })
  trailers.forEach((url, index) => {
    if (url.trim().length === 0) return
    assets.push({ kind: 'trailer', url: url.trim(), name: `trailer-${index + 1}` })
  })
  return assets
}
