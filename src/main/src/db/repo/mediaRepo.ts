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
import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '../client'
import { mediaItemTable, mediaSourceTable } from '../schema'
import type { MediaItemRow, MediaItemRowInsert, MediaSourceRow } from '../schema'

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
  return db().select().from(mediaItemTable).where(eq(mediaItemTable.id, id)).get() ?? null
}

export function listItems(libraryId: string): MediaItemRow[] {
  return db()
    .select()
    .from(mediaItemTable)
    .where(eq(mediaItemTable.libraryId, libraryId))
    .orderBy(asc(mediaItemTable.path))
    .all()
}

/** 库里的影片条目（不含目录）；`libraryId` 省略时返回全部库 */
export function listMovieItems(libraryId?: string): MediaItemRow[] {
  const typeFilter = eq(mediaItemTable.type, 'movie')
  return db()
    .select()
    .from(mediaItemTable)
    .where(libraryId ? and(typeFilter, eq(mediaItemTable.libraryId, libraryId)) : typeFilter)
    .orderBy(asc(mediaItemTable.name), asc(mediaItemTable.id))
    .all()
}

/** 按连接内路径找条目（影片 = 主媒体源路径，目录 = 目录路径） */
export function findItemByPath(connectionId: string, path: string): MediaItemRow | null {
  return (
    db()
      .select()
      .from(mediaItemTable)
      .where(and(eq(mediaItemTable.connectionId, connectionId), eq(mediaItemTable.path, path)))
      .get() ?? null
  )
}

/** 指定父条目下的直接子条目（目录浏览用） */
export function listChildItems(libraryId: string, parentId: string): MediaItemRow[] {
  return db()
    .select()
    .from(mediaItemTable)
    .where(and(eq(mediaItemTable.libraryId, libraryId), eq(mediaItemTable.parentId, parentId)))
    .orderBy(asc(mediaItemTable.type), asc(mediaItemTable.name))
    .all()
}

export function insertItem(input: MediaItemInput): void {
  const now = Date.now()
  const row: MediaItemRowInsert = {
    id: input.id,
    libraryId: input.libraryId,
    connectionId: input.connectionId,
    type: input.type,
    parentId: input.parentId ?? '',
    path: input.path ?? '',
    name: input.name,
    num: input.num ?? '',
    seasonNumber: input.seasonNumber ?? 0,
    episodeNumber: input.episodeNumber ?? 0,
    hasNfo: input.hasNfo ?? 0,
    dateAdded: now,
    updatedAt: now
  }
  db().insert(mediaItemTable).values(row).run()
}

/** 只更新扫描拥有的列，元数据列原样保留 */
export function updateItem(id: string, patch: MediaItemScanPatch): void {
  const set: Partial<MediaItemRowInsert> = { updatedAt: Date.now() }
  if (patch.libraryId !== undefined) set.libraryId = patch.libraryId
  if (patch.connectionId !== undefined) set.connectionId = patch.connectionId
  if (patch.parentId !== undefined) set.parentId = patch.parentId
  if (patch.path !== undefined) set.path = patch.path
  if (patch.name !== undefined) set.name = patch.name
  if (patch.num !== undefined) set.num = patch.num
  if (patch.seasonNumber !== undefined) set.seasonNumber = patch.seasonNumber
  if (patch.episodeNumber !== undefined) set.episodeNumber = patch.episodeNumber
  if (patch.type !== undefined) set.type = patch.type
  if (patch.hasNfo !== undefined) set.hasNfo = patch.hasNfo
  db().update(mediaItemTable).set(set).where(eq(mediaItemTable.id, id)).run()
}

/** 刮削回写元数据：整组覆盖，`title` 同时写入展示名与排序名 */
export function updateItemMetadata(itemId: string, meta: MediaItemMetadataInput): void {
  db()
    .update(mediaItemTable)
    .set({
      name: meta.title,
      sortName: meta.title,
      num: meta.num,
      originalTitle: meta.originalTitle,
      overview: meta.overview,
      tagline: meta.tagline,
      premiereDate: meta.premiereDate,
      productionYear: meta.productionYear,
      runtimeMinutes: meta.runtimeMinutes,
      officialRating: meta.officialRating,
      communityRating: meta.communityRating,
      genres: JSON.stringify(meta.genres),
      studios: JSON.stringify(meta.studios),
      tags: JSON.stringify(meta.tags),
      providerIds: JSON.stringify(meta.providerIds),
      scraperId: meta.scraperId,
      scrapedAt: meta.scrapedAt,
      updatedAt: Date.now()
    })
    .where(eq(mediaItemTable.id, itemId))
    .run()
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
 * 契约：只动刮削列（元数据一律回空、`scrapedAt = 0`），展示名与番号还原成传入的磁盘取值
 * （还原流程传还原后的文件名）；扫描拥有的列（path/type/parentId/hasNfo）一律不改，
 * `path` 由还原流程自己用 `updateItem` 更新，`hasNfo` 由下次扫描纠正。
 */
export function clearItemMetadata(itemId: string, restore: MediaItemRestoreInput): void {
  db()
    .update(mediaItemTable)
    .set({
      name: restore.name,
      sortName: '',
      num: restore.num,
      originalTitle: '',
      overview: '',
      tagline: '',
      premiereDate: '',
      productionYear: 0,
      runtimeMinutes: 0,
      officialRating: '',
      communityRating: 0,
      genres: '[]',
      studios: '[]',
      tags: '[]',
      providerIds: '{}',
      scraperId: '',
      scrapedAt: 0,
      updatedAt: Date.now()
    })
    .where(eq(mediaItemTable.id, itemId))
    .run()
}

export function deleteItem(id: string): void {
  db().delete(mediaItemTable).where(eq(mediaItemTable.id, id)).run()
}

export function countMovieItems(libraryId: string): number {
  const row = db()
    .select({ value: sql<number>`count(*)` })
    .from(mediaItemTable)
    .where(and(eq(mediaItemTable.libraryId, libraryId), eq(mediaItemTable.type, 'movie')))
    .get()
  return row?.value ?? 0
}

export function getSource(id: string): MediaSourceRow | null {
  return db().select().from(mediaSourceTable).where(eq(mediaSourceTable.id, id)).get() ?? null
}

export function listSourcesByLibrary(libraryId: string): MediaSourceRow[] {
  return db().select().from(mediaSourceTable).where(eq(mediaSourceTable.libraryId, libraryId)).all()
}

export function listSourcesByItem(itemId: string): MediaSourceRow[] {
  return db().select().from(mediaSourceTable).where(eq(mediaSourceTable.itemId, itemId)).all()
}

export function findSourceByPath(connectionId: string, path: string): MediaSourceRow | null {
  return (
    db()
      .select()
      .from(mediaSourceTable)
      .where(and(eq(mediaSourceTable.connectionId, connectionId), eq(mediaSourceTable.path, path)))
      .get() ?? null
  )
}

export function insertSource(input: MediaSourceInput, scanId: string): void {
  db()
    .insert(mediaSourceTable)
    .values({
      id: input.id,
      itemId: input.itemId,
      libraryId: input.libraryId,
      connectionId: input.connectionId,
      path: input.path,
      name: input.name,
      extname: input.extname,
      mime: input.mime,
      size: input.size,
      modifiedAt: input.modifiedAt,
      indexedAt: Date.now(),
      scanId
    })
    .run()
}

/** 按「连接 + 路径」写入或刷新媒体源；重扫只刷新扫描拥有的列 */
export function upsertSource(input: MediaSourceInput, scanId: string): void {
  // 身份按 (connectionId, path) 解析，不重算哈希：刮削会把文件移进同名文件夹，
  // 并就地改写 media_source.path 而 **保持 id 不变**。若按哈希重算 id，
  // 就会插入一条「id 已被占用、路径却是新路径」的行，直接撞主键
  // （UNIQUE constraint failed: media_source.id）。
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
  const set: Partial<MediaSourceRow> = {}
  if (patch.itemId !== undefined) set.itemId = patch.itemId
  if (patch.libraryId !== undefined) set.libraryId = patch.libraryId
  if (patch.path !== undefined) set.path = patch.path
  if (patch.name !== undefined) set.name = patch.name
  if (patch.extname !== undefined) set.extname = patch.extname
  if (patch.mime !== undefined) set.mime = patch.mime
  if (patch.size !== undefined) set.size = patch.size
  if (patch.modifiedAt !== undefined) set.modifiedAt = patch.modifiedAt
  if (patch.indexedAt !== undefined) set.indexedAt = patch.indexedAt
  if (patch.scanId !== undefined) set.scanId = patch.scanId
  if (Object.keys(set).length === 0) return
  db().update(mediaSourceTable).set(set).where(eq(mediaSourceTable.id, id)).run()
}

/** 文件被重命名 / 移动后就地更新媒体源（source id 不变） */
export function updateSourcePath(id: string, file: MediaSourceFilePatch): void {
  db()
    .update(mediaSourceTable)
    .set({
      path: file.path,
      name: file.name,
      extname: file.extname,
      mime: file.mime,
      size: file.size,
      modifiedAt: file.modifiedAt,
      indexedAt: Date.now()
    })
    .where(eq(mediaSourceTable.id, id))
    .run()
}

/** 库里最新的索引时间；没有媒体源时返回 0 */
export function maxSourceIndexedAt(): number {
  const row = db()
    .select({ value: sql<number | null>`max(${mediaSourceTable.indexedAt})` })
    .from(mediaSourceTable)
    .get()
  return row?.value ?? 0
}

/** 库里仍然没刮削过、且已经有媒体源的影片条目（刮削候选） */
export function listPendingMovieItems(libraryId: string): MediaItemRow[] {
  return db()
    .select()
    .from(mediaItemTable)
    .where(
      and(
        eq(mediaItemTable.libraryId, libraryId),
        eq(mediaItemTable.type, 'movie'),
        eq(mediaItemTable.scrapedAt, 0)
      )
    )
    .orderBy(asc(mediaItemTable.path))
    .all()
    .filter((row) => row.path.length > 0)
}
