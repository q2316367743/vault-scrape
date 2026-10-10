/**
 * 媒体图片仓储：`media_image` 表的读写。
 *
 * 契约：
 * - 图片按「连接 + 路径」唯一：同一个磁盘文件只会挂在一条记录上（目录级海报挂目录条目）；
 * - 扫描用 `upsertImage`（ID 由 mediaIndexer 按路径确定性生成），刮削用 `replaceItemImages`
 *   整组替换某个条目的图片；
 * - 返回 schema 行类型，展示形状由 mediaWall 组装。
 */
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import type { MediaImageType } from '@common/types/media/source'
import { db } from '../client'
import { mediaImageTable } from '../schema'
import type { MediaImageRow } from '../schema'

/** 带确定性 ID 的图片写入（扫描用） */
export interface MediaImageInput {
  id: string
  itemId: string
  libraryId: string
  type: MediaImageType
  connectionId: string
  path: string
  width: number
  height: number
}

/** 不带 ID 的图片写入（刮削用，ID 由仓储生成） */
export interface MediaImageDraft {
  libraryId: string
  type: MediaImageType
  connectionId: string
  path: string
  width: number
  height: number
}

export function getImage(id: string): MediaImageRow | null {
  return db().select().from(mediaImageTable).where(eq(mediaImageTable.id, id)).get() ?? null
}

export function listImagesByItem(itemId: string): MediaImageRow[] {
  return db()
    .select()
    .from(mediaImageTable)
    .where(eq(mediaImageTable.itemId, itemId))
    .all()
}

export function listImagesByLibrary(libraryId: string): MediaImageRow[] {
  return db().select().from(mediaImageTable).where(eq(mediaImageTable.libraryId, libraryId)).all()
}

export function findImageByPath(connectionId: string, path: string): MediaImageRow | null {
  return (
    db()
      .select()
      .from(mediaImageTable)
      .where(and(eq(mediaImageTable.connectionId, connectionId), eq(mediaImageTable.path, path)))
      .get() ?? null
  )
}

export function insertImage(input: MediaImageInput): void {
  db()
    .insert(mediaImageTable)
    .values({
      id: input.id,
      itemId: input.itemId,
      libraryId: input.libraryId,
      type: input.type,
      connectionId: input.connectionId,
      path: input.path,
      width: input.width,
      height: input.height,
      createdAt: Date.now()
    })
    .run()
}

/** 按「连接 + 路径」写入或刷新图片（重扫时改挂到新条目上） */
export function upsertImage(input: MediaImageInput): void {
  db()
    .insert(mediaImageTable)
    .values({
      id: input.id,
      itemId: input.itemId,
      libraryId: input.libraryId,
      type: input.type,
      connectionId: input.connectionId,
      path: input.path,
      width: input.width,
      height: input.height,
      createdAt: Date.now()
    })
    .onConflictDoUpdate({
      target: [mediaImageTable.connectionId, mediaImageTable.path],
      set: {
        itemId: input.itemId,
        libraryId: input.libraryId,
        type: input.type,
        width: input.width,
        height: input.height
      }
    })
    .run()
}

/** 整组替换某条目的图片（刮削成功后调用） */
export function replaceItemImages(itemId: string, images: readonly MediaImageDraft[]): void {
  db().delete(mediaImageTable).where(eq(mediaImageTable.itemId, itemId)).run()
  for (const image of images) {
    upsertImage({ id: randomUUID(), itemId, ...image })
  }
}

export function deleteImage(id: string): boolean {
  const rows = db().delete(mediaImageTable).where(eq(mediaImageTable.id, id)).returning({ id: mediaImageTable.id }).all()
  return rows.length > 0
}

export function deleteImagesByItem(itemId: string): number {
  return db().delete(mediaImageTable).where(eq(mediaImageTable.itemId, itemId)).returning({ id: mediaImageTable.id }).all()
    .length
}

export function deleteImagesByItems(itemIds: readonly string[]): number {
  if (itemIds.length === 0) return 0
  return db()
    .delete(mediaImageTable)
    .where(inArray(mediaImageTable.itemId, [...itemIds]))
    .returning({ id: mediaImageTable.id })
    .all().length
}

export function deleteImagesByIds(ids: readonly string[]): number {
  if (ids.length === 0) return 0
  return db()
    .delete(mediaImageTable)
    .where(inArray(mediaImageTable.id, [...ids]))
    .returning({ id: mediaImageTable.id })
    .all().length
}

export function deleteImagesByLibrary(libraryId: string): number {
  return db()
    .delete(mediaImageTable)
    .where(eq(mediaImageTable.libraryId, libraryId))
    .returning({ id: mediaImageTable.id })
    .all().length
}

export function deleteImagesByConnection(connectionId: string): number {
  return db()
    .delete(mediaImageTable)
    .where(eq(mediaImageTable.connectionId, connectionId))
    .returning({ id: mediaImageTable.id })
    .all().length
}
