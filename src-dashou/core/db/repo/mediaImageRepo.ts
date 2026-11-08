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
import type { MediaImageType } from '@common/types/media/source'
import { transaction } from '../client'
import { MEDIA_IMAGE_COLUMNS } from '../columns'
import { allOf, oneOf, placeholders, runOf, type SqlValue } from '../query'
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
  return oneOf<MediaImageRow>(`SELECT ${MEDIA_IMAGE_COLUMNS} FROM media_image WHERE id = ?`, [id])
}

export function listImagesByItem(itemId: string): MediaImageRow[] {
  return allOf<MediaImageRow>(
    `SELECT ${MEDIA_IMAGE_COLUMNS} FROM media_image WHERE item_id = ?`,
    [itemId]
  )
}

export function listImagesByLibrary(libraryId: string): MediaImageRow[] {
  return allOf<MediaImageRow>(
    `SELECT ${MEDIA_IMAGE_COLUMNS} FROM media_image WHERE library_id = ?`,
    [libraryId]
  )
}

export function findImageByPath(connectionId: string, path: string): MediaImageRow | null {
  return oneOf<MediaImageRow>(
    `SELECT ${MEDIA_IMAGE_COLUMNS} FROM media_image WHERE connection_id = ? AND path = ?`,
    [connectionId, path]
  )
}

export function insertImage(input: MediaImageInput): void {
  runOf(
    `INSERT INTO media_image (id, item_id, library_id, type, connection_id, path, width, height,
      created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.itemId,
      input.libraryId,
      input.type,
      input.connectionId,
      input.path,
      input.width,
      input.height,
      Date.now()
    ]
  )
}

/** 按「连接 + 路径」写入或刷新图片（重扫时改挂到新条目上） */
export function upsertImage(input: MediaImageInput): void {
  runOf(
    `INSERT INTO media_image (id, item_id, library_id, type, connection_id, path, width, height,
      created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(connection_id, path) DO UPDATE SET
      item_id = excluded.item_id,
      library_id = excluded.library_id,
      type = excluded.type,
      width = excluded.width,
      height = excluded.height`,
    [
      input.id,
      input.itemId,
      input.libraryId,
      input.type,
      input.connectionId,
      input.path,
      input.width,
      input.height,
      Date.now()
    ]
  )
}

/** 整组替换某条目的图片（刮削成功后调用） */
export function replaceItemImages(itemId: string, images: readonly MediaImageDraft[]): void {
  transaction(() => {
    runOf('DELETE FROM media_image WHERE item_id = ?', [itemId])
    for (const image of images) {
      upsertImage({ id: randomUUID(), itemId, ...image })
    }
  })
}

export function deleteImage(id: string): boolean {
  return runOf('DELETE FROM media_image WHERE id = ?', [id]) > 0
}

export function deleteImagesByItem(itemId: string): number {
  return runOf('DELETE FROM media_image WHERE item_id = ?', [itemId])
}

export function deleteImagesByItems(itemIds: readonly string[]): number {
  if (itemIds.length === 0) return 0
  return runOf(
    `DELETE FROM media_image WHERE item_id IN (${placeholders(itemIds.length)})`,
    itemIds as SqlValue[]
  )
}

export function deleteImagesByIds(ids: readonly string[]): number {
  if (ids.length === 0) return 0
  return runOf(
    `DELETE FROM media_image WHERE id IN (${placeholders(ids.length)})`,
    ids as SqlValue[]
  )
}

export function deleteImagesByLibrary(libraryId: string): number {
  return runOf('DELETE FROM media_image WHERE library_id = ?', [libraryId])
}

export function deleteImagesByConnection(connectionId: string): number {
  return runOf('DELETE FROM media_image WHERE connection_id = ?', [connectionId])
}
