/**
 * 媒体仓储：`media_item` 与 `media_source` 两张表的读写。
 *
 * 契约：
 * - 返回 schema 行类型（`MediaItemRow` / `MediaSourceRow`），展示形状由 mediaWall 组装；
 * - 扫描只刷新「扫描拥有」的列（path/name/extname/mime/size/modifiedAt/indexedAt/scanId/parentId/hasNfo），
 *   刮削元数据列一律不动，保证重扫不丢元数据；
 * - `genres` / `studios` / `tags` / `providerIds` 是 JSON 文本列，读写都走本文件的转换函数。
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { isRemotePathInside } from '@common/types/file'
import { db } from '../client'
import { mediaItemTable, mediaSourceTable } from '../schema'
import type { MediaItemRow, MediaItemRowInsert, MediaSourceRow } from '../schema'

/** 条目类型；本阶段只落地影片与目录 */
export type MediaItemType = 'movie' | 'folder'

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

/** 指定父条目下的直接子条目（工作台浏览用） */
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

export function deleteItem(id: string): void {
  db().delete(mediaItemTable).where(eq(mediaItemTable.id, id)).run()
}

/** 按主键批量删除的分块大小 */
const DELETE_CHUNK = 500

/** 路径是否落在本次被跳过的目录之下（跳过 = 目录没列出来，不代表内容已删除） */
function isUnderSkippedDir(path: string, skippedDirs: readonly string[]): boolean {
  return skippedDirs.some((dir) => isRemotePathInside(dir, path))
}

/**
 * 删掉「所有媒体源都不属于本次扫描」的影片条目，返回被删掉的条目 ID。
 *
 * 必须在删除旧媒体源**之前**调用：先把整组源都过期的条目挑出来，再交给清理逻辑连带删图片。
 *
 * `skippedDirs` 是本次列目录失败被跳过的目录：这些目录下的旧媒体源没能被打上新 `scanId`，
 * 但它们并没有从磁盘上消失，因此一律视为有效，避免一次网络抖动就删掉条目与刮削图片。
 */
export function deleteItemsWithoutSource(
  libraryId: string,
  scanId: string,
  skippedDirs: readonly string[] = []
): string[] {
  const sources = db()
    .select({
      itemId: mediaSourceTable.itemId,
      scanId: mediaSourceTable.scanId,
      path: mediaSourceTable.path
    })
    .from(mediaSourceTable)
    .where(eq(mediaSourceTable.libraryId, libraryId))
    .all()
  if (sources.length === 0) return []
  const current = new Set<string>()
  const all = new Set<string>()
  for (const row of sources) {
    all.add(row.itemId)
    if (row.scanId === scanId || isUnderSkippedDir(row.path, skippedDirs)) current.add(row.itemId)
  }
  const orphanIds = [...all].filter((itemId) => !current.has(itemId))
  if (orphanIds.length === 0) return []
  const rows = db()
    .select({ id: mediaItemTable.id })
    .from(mediaItemTable)
    .where(
      and(
        eq(mediaItemTable.libraryId, libraryId),
        eq(mediaItemTable.type, 'movie'),
        inArray(mediaItemTable.id, orphanIds)
      )
    )
    .all()
  const ids = rows.map((row) => row.id)
  if (ids.length > 0) db().delete(mediaItemTable).where(inArray(mediaItemTable.id, ids)).run()
  return ids
}

export function countMovieItems(libraryId: string): number {
  const row = db()
    .select({ value: sql<number>`count(*)` })
    .from(mediaItemTable)
    .where(and(eq(mediaItemTable.libraryId, libraryId), eq(mediaItemTable.type, 'movie')))
    .get()
  return row?.value ?? 0
}

export function countScrapedMovieItems(libraryId: string): number {
  const row = db()
    .select({ value: sql<number>`count(*)` })
    .from(mediaItemTable)
    .where(
      and(
        eq(mediaItemTable.libraryId, libraryId),
        eq(mediaItemTable.type, 'movie'),
        // 与 mediaWall.scrapedOf 同一口径：自己跑过刮削，或磁盘上已经有产出（NFO / 图片）。
        // `media_image` 即 schema/mediaImage.ts 的表，这里用字面量是为了在 where 里写 exists 子查询。
        sql`(${mediaItemTable.scrapedAt} > 0 or ${mediaItemTable.hasNfo} > 0 or exists (
          select 1 from media_image
          where media_image.item_id = ${mediaItemTable.id}
             or media_image.item_id = ${mediaItemTable.parentId}
        ))`
      )
    )
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
  const now = Date.now()
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
      indexedAt: now,
      scanId
    })
    .onConflictDoUpdate({
      target: [mediaSourceTable.connectionId, mediaSourceTable.path],
      set: {
        itemId: input.itemId,
        libraryId: input.libraryId,
        name: input.name,
        extname: input.extname,
        mime: input.mime,
        size: input.size,
        modifiedAt: input.modifiedAt,
        indexedAt: now,
        scanId
      }
    })
    .run()
}

export function updateSource(id: string, patch: MediaSourceScanPatch): void {
  const set: Partial<MediaSourceRow> = {}
  if (patch.itemId !== undefined) set.itemId = patch.itemId
  if (patch.libraryId !== undefined) set.libraryId = patch.libraryId
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

/**
 * 清掉本库中不属于本次扫描的媒体源，返回删除数量。
 *
 * `skippedDirs` 下（列目录失败被跳过）的媒体源保留，理由同 `deleteItemsWithoutSource`。
 * 删除按主键分块，避免一次性 `IN` 过多参数。
 */
export function deleteSourcesNotInScan(
  libraryId: string,
  scanId: string,
  skippedDirs: readonly string[] = []
): number {
  const stale = db()
    .select({ id: mediaSourceTable.id, path: mediaSourceTable.path })
    .from(mediaSourceTable)
    .where(and(eq(mediaSourceTable.libraryId, libraryId), sql`${mediaSourceTable.scanId} <> ${scanId}`))
    .all()
    .filter((row) => !isUnderSkippedDir(row.path, skippedDirs))
    .map((row) => row.id)
  let removed = 0
  for (let index = 0; index < stale.length; index += DELETE_CHUNK) {
    const ids = stale.slice(index, index + DELETE_CHUNK)
    removed += db()
      .delete(mediaSourceTable)
      .where(inArray(mediaSourceTable.id, ids))
      .returning({ id: mediaSourceTable.id })
      .all().length
  }
  return removed
}

/** 库里最新的索引时间；没有媒体源时返回 0 */
export function maxSourceIndexedAt(): number {
  const row = db()
    .select({ value: sql<number | null>`max(${mediaSourceTable.indexedAt})` })
    .from(mediaSourceTable)
    .get()
  return row?.value ?? 0
}

export function deleteSourcesByLibrary(libraryId: string): number {
  return db()
    .delete(mediaSourceTable)
    .where(eq(mediaSourceTable.libraryId, libraryId))
    .returning({ id: mediaSourceTable.id })
    .all().length
}

export function deleteSourcesByConnection(connectionId: string): number {
  return db()
    .delete(mediaSourceTable)
    .where(eq(mediaSourceTable.connectionId, connectionId))
    .returning({ id: mediaSourceTable.id })
    .all().length
}

/** 删掉一个库的全部条目，返回被删掉的条目 ID */
export function deleteItemsByLibrary(libraryId: string): string[] {
  return db()
    .delete(mediaItemTable)
    .where(eq(mediaItemTable.libraryId, libraryId))
    .returning({ id: mediaItemTable.id })
    .all()
    .map((row) => row.id)
}

/** 删掉一个连接的全部条目，返回被删掉的条目 ID */
export function deleteItemsByConnection(connectionId: string): string[] {
  return db()
    .delete(mediaItemTable)
    .where(eq(mediaItemTable.connectionId, connectionId))
    .returning({ id: mediaItemTable.id })
    .all()
    .map((row) => row.id)
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
