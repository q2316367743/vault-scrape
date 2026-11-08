/**
 * 媒体仓储：`media_item` 与 `media_source` 两张表的读写。
 *
 * 契约：
 * - 返回 schema 行类型（`MediaItemRow` / `MediaSourceRow`），展示形状由 mediaWall 组装；
 * - 扫描只刷新「扫描拥有」的列（path/name/extname/mime/size/modifiedAt/indexedAt/scanId/parentId/hasNfo），
 *   刮削元数据列一律不动，保证重扫不丢元数据；
 * - `genres` / `studios` / `tags` / `providerIds` 是 JSON 文本列，读写都走本文件的转换函数；
 * - 扫描收尾与「删库 / 删连接」的批量清理在 `mediaCleanupRepo.ts`。
 */
import { MEDIA_ITEM_COLUMNS, MEDIA_SOURCE_COLUMNS } from '../columns'
import { allOf, oneOf, runOf, type SqlValue } from '../query'
import type { MediaItemRow, MediaSourceRow } from '../schema'
import { deleteTranslation } from './translationRepo'

/** 条目类型；影视库用影片与目录，剧集库用剧集 / 季 / 集（只有集挂媒体源） */
export type MediaItemType = 'movie' | 'folder' | 'series' | 'season' | 'episode'

/** 刮削写回的条目元数据（整组覆盖，缺省用空值） */
export interface MediaItemMetadataInput {
  title: string
  num: string
  originalTitle: string
  overview: string
  tagline: string
  premiereDate: string
  productionYear: number
  runtimeMinutes: number
  officialRating: string
  communityRating: number
  genres: string[]
  studios: string[]
  tags: string[]
  /** 片商、厂牌、系列、导演：详情页分行展示的四个字段，不从 `studios` 里拆 */
  maker: string
  label: string
  series: string
  director: string
  providerIds: Record<string, string>
  scraperId: string
  scrapedAt: number
}

/** 条目元数据（JSON 列已解析） */
export interface MediaItemMetadata {
  genres: string[]
  studios: string[]
  tags: string[]
  providerIds: Record<string, string>
}

/**
 * 扫描从磁盘 NFO 读到的元数据（用于「扫描读 NFO 落库」）。
 *
 * 与刮削回写的区别：只写传进来的字段，不动 `scraperId` / `scrapedAt`，也不清空没传的列。
 */
export interface MediaItemScannedMetadataInput {
  /** 展示名（NFO 的 `<title>`）；不传或空串就不改 */
  title?: string
  num?: string
  originalTitle?: string
  overview?: string
  premiereDate?: string
  productionYear?: number
  runtimeMinutes?: number
  genres?: string[]
  studios?: string[]
  tags?: string[]
  /** 片商、厂牌、系列、导演：NFO 里读到才写 */
  maker?: string
  label?: string
  series?: string
  director?: string
  providerIds?: Record<string, string>
}

/** 只允许扫描改写的条目列 */
export interface MediaItemScanPatch {
  libraryId?: string
  connectionId?: string
  parentId?: string
  path?: string
  name?: string
  num?: string
  /** 季号（剧集链路）；series 为 0，season / episode 是实际季号 */
  seasonNumber?: number
  /** 集号（剧集链路）；仅 episode 有值，从 1 开始 */
  episodeNumber?: number
  type?: MediaItemType
  /** 同目录有没有 NFO（1 = 有）；扫描写，读侧用来判断磁盘上是否已有刮削产出 */
  hasNfo?: number
}

export interface MediaItemInput extends MediaItemScanPatch {
  id: string
  libraryId: string
  connectionId: string
  type: MediaItemType
  name: string
}

/** 只允许扫描改写的媒体源列 */
export interface MediaSourceScanPatch {
  itemId?: string
  libraryId?: string
  /** 文件被移动后就地改写；身份按 (connectionId, path) 解析，id 不变 */
  path?: string
  name?: string
  extname?: string
  mime?: string
  size?: number
  modifiedAt?: number
  indexedAt?: number
  scanId?: string
}

export interface MediaSourceInput {
  id: string
  itemId: string
  libraryId: string
  connectionId: string
  path: string
  name: string
  extname: string
  mime: string
  size: number
  modifiedAt: number
}

export interface MediaSourceFilePatch {
  path: string
  name: string
  extname: string
  mime: string
  size: number
  modifiedAt: number
}

/** MediaItemScanPatch 的 camelCase 键 → SQL 列名 */
const ITEM_SCAN_COLUMN_OF: Readonly<Record<keyof MediaItemScanPatch, string>> = {
  libraryId: 'library_id',
  connectionId: 'connection_id',
  parentId: 'parent_id',
  path: 'path',
  name: 'name',
  num: 'num',
  seasonNumber: 'season_number',
  episodeNumber: 'episode_number',
  type: 'type',
  hasNfo: 'has_nfo'
}

/** MediaSourceScanPatch 的 camelCase 键 → SQL 列名 */
const SOURCE_SCAN_COLUMN_OF: Readonly<Record<keyof MediaSourceScanPatch, string>> = {
  itemId: 'item_id',
  libraryId: 'library_id',
  path: 'path',
  name: 'name',
  extname: 'extname',
  mime: 'mime',
  size: 'size',
  modifiedAt: 'modified_at',
  indexedAt: 'indexed_at',
  scanId: 'scan_id'
}

function parseStringList(text: string): string[] {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

function parseStringMap(text: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') result[key] = value
    }
    return result
  } catch {
    return {}
  }
}

/** 读回条目上的 JSON 列 */
export function readItemMetadata(row: MediaItemRow): MediaItemMetadata {
  return {
    genres: parseStringList(row.genres),
    studios: parseStringList(row.studios),
    tags: parseStringList(row.tags),
    providerIds: parseStringMap(row.providerIds)
  }
}

export function getItem(id: string): MediaItemRow | null {
  return oneOf<MediaItemRow>(`SELECT ${MEDIA_ITEM_COLUMNS} FROM media_item WHERE id = ?`, [id])
}

export function listItems(libraryId: string): MediaItemRow[] {
  return allOf<MediaItemRow>(
    `SELECT ${MEDIA_ITEM_COLUMNS} FROM media_item WHERE library_id = ? ORDER BY path ASC`,
    [libraryId]
  )
}

/** 库里的影片条目（不含目录）；`libraryId` 省略时返回全部库 */
export function listMovieItems(libraryId?: string): MediaItemRow[] {
  if (libraryId) {
    return allOf<MediaItemRow>(
      `SELECT ${MEDIA_ITEM_COLUMNS} FROM media_item WHERE type = 'movie' AND library_id = ?
        ORDER BY name ASC, id ASC`,
      [libraryId]
    )
  }
  return allOf<MediaItemRow>(
    `SELECT ${MEDIA_ITEM_COLUMNS} FROM media_item WHERE type = 'movie' ORDER BY name ASC, id ASC`
  )
}

/** 按连接内路径找条目（影片 = 主媒体源路径，目录 = 目录路径） */
export function findItemByPath(connectionId: string, path: string): MediaItemRow | null {
  return oneOf<MediaItemRow>(
    `SELECT ${MEDIA_ITEM_COLUMNS} FROM media_item WHERE connection_id = ? AND path = ?`,
    [connectionId, path]
  )
}

/** 指定父条目下的直接子条目（目录浏览用） */
export function listChildItems(libraryId: string, parentId: string): MediaItemRow[] {
  return allOf<MediaItemRow>(
    `SELECT ${MEDIA_ITEM_COLUMNS} FROM media_item WHERE library_id = ? AND parent_id = ?
      ORDER BY type ASC, name ASC`,
    [libraryId, parentId]
  )
}

export function insertItem(input: MediaItemInput): void {
  const now = Date.now()
  runOf(
    `INSERT INTO media_item (id, library_id, connection_id, type, parent_id, path, name, num,
      season_number, episode_number, has_nfo, date_added, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.libraryId,
      input.connectionId,
      input.type,
      input.parentId ?? '',
      input.path ?? '',
      input.name,
      input.num ?? '',
      input.seasonNumber ?? 0,
      input.episodeNumber ?? 0,
      input.hasNfo ?? 0,
      now,
      now
    ]
  )
}

/** 只更新扫描拥有的列，元数据列原样保留 */
export function updateItem(id: string, patch: MediaItemScanPatch): void {
  const sets: string[] = ['updated_at = ?']
  const params: SqlValue[] = [Date.now()]
  for (const [key, value] of Object.entries(patch)) {
    const column = ITEM_SCAN_COLUMN_OF[key as keyof MediaItemScanPatch]
    if (!column || value === undefined) continue
    sets.push(`${column} = ?`)
    params.push(value as SqlValue)
  }
  params.push(id)
  runOf(`UPDATE media_item SET ${sets.join(', ')} WHERE id = ?`, params)
}

/** 刮削回写元数据：整组覆盖，`title` 同时写入展示名与排序名 */
export function updateItemMetadata(itemId: string, meta: MediaItemMetadataInput): void {
  runOf(
    `UPDATE media_item SET name = ?, sort_name = ?, num = ?, original_title = ?, overview = ?,
      tagline = ?, premiere_date = ?, production_year = ?, runtime_minutes = ?,
      official_rating = ?, community_rating = ?, genres = ?, studios = ?, tags = ?,
      maker = ?, label = ?, series = ?, director = ?, provider_ids = ?, scraper_id = ?,
      scraped_at = ?, updated_at = ? WHERE id = ?`,
    [
      meta.title,
      meta.title,
      meta.num,
      meta.originalTitle,
      meta.overview,
      meta.tagline,
      meta.premiereDate,
      meta.productionYear,
      meta.runtimeMinutes,
      meta.officialRating,
      meta.communityRating,
      JSON.stringify(meta.genres),
      JSON.stringify(meta.studios),
      JSON.stringify(meta.tags),
      meta.maker,
      meta.label,
      meta.series,
      meta.director,
      JSON.stringify(meta.providerIds),
      meta.scraperId,
      meta.scrapedAt,
      Date.now(),
      itemId
    ]
  )
}

/** 扫描读 NFO 回写元数据：只覆盖传进来的字段，不动刮削标记 */
export function applyScannedMetadata(itemId: string, meta: MediaItemScannedMetadataInput): void {
  const sets: string[] = []
  const params: SqlValue[] = []
  const text = (value: string | undefined): string | undefined => {
    const trimmed = (value ?? '').trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  const put = (column: string, value: SqlValue | undefined): void => {
    if (value === undefined) return
    sets.push(`${column} = ?`)
    params.push(value)
  }
  const title = text(meta.title)
  if (title !== undefined) {
    put('name', title)
    put('sort_name', title)
  }
  put('num', text(meta.num))
  put('original_title', text(meta.originalTitle))
  put('overview', text(meta.overview))
  put('premiere_date', text(meta.premiereDate))
  if ((meta.productionYear ?? 0) > 0) put('production_year', meta.productionYear)
  if ((meta.runtimeMinutes ?? 0) > 0) put('runtime_minutes', meta.runtimeMinutes)
  if ((meta.genres ?? []).length > 0) put('genres', JSON.stringify(meta.genres))
  if ((meta.studios ?? []).length > 0) put('studios', JSON.stringify(meta.studios))
  if ((meta.tags ?? []).length > 0) put('tags', JSON.stringify(meta.tags))
  put('maker', text(meta.maker))
  put('label', text(meta.label))
  put('series', text(meta.series))
  put('director', text(meta.director))
  if (Object.keys(meta.providerIds ?? {}).length > 0) {
    put('provider_ids', JSON.stringify(meta.providerIds))
  }
  if (sets.length === 0) return
  sets.push('updated_at = ?')
  params.push(Date.now(), itemId)
  runOf(`UPDATE media_item SET ${sets.join(', ')} WHERE id = ?`, params)
}

/** 「还原刮削前」要还原的取值：视频还原到位后的样子 */
export interface MediaItemRestoreInput {
  /** 还原后的视频文件名（含扩展名），即扫描会写下的展示名 */
  name: string
  /** 从该文件名解析出的番号 */
  num: string
}

/**
 * 清除刮削回写的元数据，把条目退回「扫描过、还没刮」的状态。
 *
 * 只动刮削列（元数据一律回空、`scrapedAt = 0`），展示名与番号还原成传入的磁盘取值；
 * 扫描拥有的列（path/type/parentId）一律不改。译文也一并删掉。
 */
export function clearItemMetadata(itemId: string, restore: MediaItemRestoreInput): void {
  deleteTranslation(itemId)
  runOf(
    `UPDATE media_item SET has_nfo = 0, name = ?, sort_name = '', num = ?, original_title = '',
      overview = '', tagline = '', premiere_date = '', production_year = 0,
      runtime_minutes = 0, official_rating = '', community_rating = 0, genres = '[]',
      studios = '[]', tags = '[]', maker = '', label = '', series = '', director = '',
      provider_ids = '{}', scraper_id = '', scraped_at = 0, updated_at = ? WHERE id = ?`,
    [restore.name, restore.num, Date.now(), itemId]
  )
}

export function deleteItem(id: string): void {
  runOf('DELETE FROM media_item WHERE id = ?', [id])
}

export function countMovieItems(libraryId: string): number {
  const row = oneOf<{ value: number }>(
    `SELECT count(*) AS value FROM media_item WHERE library_id = ? AND type = 'movie'`,
    [libraryId]
  )
  return Number(row?.value ?? 0)
}

export function getSource(id: string): MediaSourceRow | null {
  return oneOf<MediaSourceRow>(`SELECT ${MEDIA_SOURCE_COLUMNS} FROM media_source WHERE id = ?`, [
    id
  ])
}

export function listSourcesByLibrary(libraryId: string): MediaSourceRow[] {
  return allOf<MediaSourceRow>(
    `SELECT ${MEDIA_SOURCE_COLUMNS} FROM media_source WHERE library_id = ?`,
    [libraryId]
  )
}

export function listSourcesByItem(itemId: string): MediaSourceRow[] {
  // 排序是契约的一部分：一个影片条目可以有多个版本（多个源），
  // `primarySourceOf` 在没有「源路径 == 条目路径」时取第一条，顺序必须稳定
  return allOf<MediaSourceRow>(
    `SELECT ${MEDIA_SOURCE_COLUMNS} FROM media_source WHERE item_id = ? ORDER BY path ASC`,
    [itemId]
  )
}

export function findSourceByPath(connectionId: string, path: string): MediaSourceRow | null {
  return oneOf<MediaSourceRow>(
    `SELECT ${MEDIA_SOURCE_COLUMNS} FROM media_source WHERE connection_id = ? AND path = ?`,
    [connectionId, path]
  )
}

export function insertSource(input: MediaSourceInput, scanId: string): void {
  runOf(
    `INSERT INTO media_source (id, item_id, library_id, connection_id, path, name, extname,
      mime, size, modified_at, indexed_at, scan_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.itemId,
      input.libraryId,
      input.connectionId,
      input.path,
      input.name,
      input.extname,
      input.mime,
      input.size,
      input.modifiedAt,
      Date.now(),
      scanId
    ]
  )
}

/** 按「连接 + 路径」写入或刷新媒体源；重扫只刷新扫描拥有的列 */
export function upsertSource(input: MediaSourceInput, scanId: string): void {
  // 身份按 (connectionId, path) 解析，不重算哈希：刮削会把文件移进同名文件夹，
  // 并就地改写 media_source.path 而 **保持 id 不变**。若按哈希重算 id，
  // 就会插入一条「id 已被占用、路径却是新路径」的行，直接撞主键。
  const existing = findSourceByPath(input.connectionId, input.path) ?? getSource(input.id)
  if (existing) {
    // 第二条分支是历史遗留的「id 属于这条路经、行里记着别的路径」：把它改回来
    updateSource(existing.id, {
      itemId: input.itemId,
      libraryId: input.libraryId,
      path: input.path,
      name: input.name,
      extname: input.extname,
      mime: input.mime,
      size: input.size,
      modifiedAt: input.modifiedAt,
      indexedAt: Date.now(),
      scanId
    })
    return
  }
  insertSource(input, scanId)
}

export function updateSource(id: string, patch: MediaSourceScanPatch): void {
  const sets: string[] = []
  const params: SqlValue[] = []
  for (const [key, value] of Object.entries(patch)) {
    const column = SOURCE_SCAN_COLUMN_OF[key as keyof MediaSourceScanPatch]
    if (!column || value === undefined) continue
    sets.push(`${column} = ?`)
    params.push(value as SqlValue)
  }
  if (sets.length === 0) return
  params.push(id)
  runOf(`UPDATE media_source SET ${sets.join(', ')} WHERE id = ?`, params)
}

/** 文件被重命名 / 移动后就地更新媒体源（source id 不变） */
export function updateSourcePath(id: string, file: MediaSourceFilePatch): void {
  runOf(
    `UPDATE media_source SET path = ?, name = ?, extname = ?, mime = ?, size = ?,
      modified_at = ?, indexed_at = ? WHERE id = ?`,
    [
      file.path,
      file.name,
      file.extname,
      file.mime,
      file.size,
      file.modifiedAt,
      Date.now(),
      id
    ]
  )
}

/** 库里最新的索引时间；没有媒体源时返回 0 */
export function maxSourceIndexedAt(): number {
  const row = oneOf<{ value: number | null }>('SELECT max(indexed_at) AS value FROM media_source')
  return Number(row?.value ?? 0)
}

/**
 * 库里仍然没刮削过、且已经有媒体源的影片条目（刮削候选）。
 *
 * `has_nfo = 1`（扫描时已按 `movie.nfo` / `<目录名>.nfo` / `<视频文件名>.nfo` 判过）
 * 视为「已有元数据」，不进批量候选：这类影片只能从详情页手动刮，避免批量任务把它们
 * 重刮一遍、覆盖掉磁盘上已有的 NFO。
 */
export function listPendingMovieItems(libraryId: string): MediaItemRow[] {
  return allOf<MediaItemRow>(
    `SELECT ${MEDIA_ITEM_COLUMNS} FROM media_item
      WHERE library_id = ? AND type = 'movie' AND scraped_at = 0 AND has_nfo = 0 AND path <> ''
      ORDER BY path ASC`,
    [libraryId]
  )
}
