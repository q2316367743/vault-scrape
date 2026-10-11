/**
 * 媒体清理仓储：扫描收尾与资料库 / 连接删除时的批量清理。
 *
 * 契约：
 * - 只做批量删除与「谁该被删」的判定，不组装展示形状；
 * - `skippedDirs`（本次列目录失败被跳过的目录）下的旧媒体源一律视为有效，
 *   避免一次网络抖动就删掉条目与刮削图片；
 * - 删除按主键分块（`DELETE_CHUNK`），避免一次性 `IN` 过多参数；
 * - 条目被删时连带清掉它的参演名单（`media_cast` 是按 itemId 挂的弱关联行）。
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import { isRemotePathInside } from '@common/types/file'
import { db } from '../client'
import { mediaItemTable, mediaSourceTable } from '../schema'
import { deleteCastByItems } from './actorRepo'
import type { MediaItemType } from './mediaRepo'

/** 按主键批量删除的分块大小 */
const DELETE_CHUNK = 500

/** 路径是否落在本次被跳过的目录之下（跳过 = 目录没列出来，不代表内容已删除） */
function isUnderSkippedDir(path: string, skippedDirs: readonly string[]): boolean {
  return skippedDirs.some((dir) => isRemotePathInside(dir, path))
}

/**
 * 清掉本库中不属于本次扫描的媒体源，返回删除数量。
 *
 * `skippedDirs` 下（列目录失败被跳过）的媒体源保留，理由同 `deleteItemsWithoutSource`。
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

/**
 * 删掉「所有媒体源都不属于本次扫描」的条目，返回被删掉的条目 ID。
 *
 * 必须在删除旧媒体源**之前**调用：先把整组源都过期的条目挑出来，再交给清理逻辑连带删图片。
 *
 * `types` 是本次要清理的条目类型：影片库传 `['movie']`，剧集库传 `['episode']`。
 * 剧集 / 季条目本身不挂媒体源，走 `deleteChildlessItems`。
 */
export function deleteItemsWithoutSource(
  libraryId: string,
  scanId: string,
  skippedDirs: readonly string[],
  types: readonly MediaItemType[]
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
        inArray(mediaItemTable.type, types),
        inArray(mediaItemTable.id, orphanIds)
      )
    )
    .all()
  const ids = rows.map((row) => row.id)
  if (ids.length > 0) {
    db().delete(mediaItemTable).where(inArray(mediaItemTable.id, ids)).run()
    deleteCastByItems(ids)
  }
  return ids
}

/**
 * 删掉已经没有任何子条目的空壳条目（剧集库收尾用），返回被删掉的条目 ID。
 *
 * 剧集库的季 / 剧集条目本身不挂媒体源，判断「该不该留」只能看它下面还有没有东西：
 * 调用方要**自底向上**传类型（先 `['season']` 再 `['series']`），这样整条链空了会被逐层收掉。
 * `skippedDirs`（本次列目录失败的目录）下的条目一律保留，避免一次读目录失败就删数据。
 */
export function deleteChildlessItems(
  libraryId: string,
  types: readonly MediaItemType[],
  skippedDirs: readonly string[] = []
): string[] {
  const missingChildren = sql`not exists (select 1 from media_item as child where child.parent_id = ${mediaItemTable.id})`
  const rows = db()
    .select({ id: mediaItemTable.id, path: mediaItemTable.path })
    .from(mediaItemTable)
    .where(
      and(eq(mediaItemTable.libraryId, libraryId), inArray(mediaItemTable.type, types), missingChildren)
    )
    .all()
    .filter((row) => !isUnderSkippedDir(row.path, skippedDirs))
  const ids = rows.map((row) => row.id)
  if (ids.length > 0) {
    db().delete(mediaItemTable).where(inArray(mediaItemTable.id, ids)).run()
    deleteCastByItems(ids)
  }
  return ids
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
  const ids = db()
    .delete(mediaItemTable)
    .where(eq(mediaItemTable.libraryId, libraryId))
    .returning({ id: mediaItemTable.id })
    .all()
    .map((row) => row.id)
  deleteCastByItems(ids)
  return ids
}

/** 删掉一个连接的全部条目，返回被删掉的条目 ID */
export function deleteItemsByConnection(connectionId: string): string[] {
  const ids = db()
    .delete(mediaItemTable)
    .where(eq(mediaItemTable.connectionId, connectionId))
    .returning({ id: mediaItemTable.id })
    .all()
    .map((row) => row.id)
  deleteCastByItems(ids)
  return ids
}
