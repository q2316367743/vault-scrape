import { and, asc, count, eq, inArray } from 'drizzle-orm'
import type { ResourceItem } from '@common/types/resource'
import { db } from '../client'
import { resourceTable, type ResourceRow } from '../schema'

/** 行 → 公共形状（两者字段一一对应，这里显式收窄以隔离 schema 细节） */
function toItem(row: ResourceRow): ResourceItem {
  return {
    id: row.id,
    connectionId: row.connectionId,
    dirPath: row.dirPath,
    path: row.path,
    name: row.name,
    extname: row.extname,
    mime: row.mime,
    size: row.size,
    modifiedAt: row.modifiedAt,
    kind: row.kind,
    indexedAt: row.indexedAt
  }
}

/**
 * 用一次扫描的结果替换某个目录的索引。
 *
 * 幂等：同一目录重复扫描不会翻倍；同一个文件被另一个媒体库根再次索引时，
 * 以最后一次扫描为准（唯一索引建在「存储 + 路径」上）。
 */
export function replaceResourceDir(
  connectionId: string,
  dirPath: string,
  items: readonly ResourceItem[]
): void {
  db().transaction((tx) => {
    tx.delete(resourceTable)
      .where(
        and(eq(resourceTable.connectionId, connectionId), eq(resourceTable.dirPath, dirPath))
      )
      .run()
    if (items.length === 0) return
    tx.delete(resourceTable)
      .where(
        and(
          eq(resourceTable.connectionId, connectionId),
          inArray(
            resourceTable.path,
            items.map((item) => item.path)
          )
        )
      )
      .run()
    tx.insert(resourceTable).values([...items]).run()
  })
}

export function getResourceById(id: string): ResourceItem | null {
  const row = db().select().from(resourceTable).where(eq(resourceTable.id, id)).get()
  return row ? toItem(row) : null
}

export function listResourceByDir(connectionId: string, dirPath: string): ResourceItem[] {
  return db()
    .select()
    .from(resourceTable)
    .where(and(eq(resourceTable.connectionId, connectionId), eq(resourceTable.dirPath, dirPath)))
    .orderBy(asc(resourceTable.name))
    .all()
    .map(toItem)
}

export function countResource(connectionId: string): number {
  const row = db()
    .select({ value: count() })
    .from(resourceTable)
    .where(eq(resourceTable.connectionId, connectionId))
    .get()
  return row?.value ?? 0
}

/** 删除存储时清理其索引，避免留下悬空资源 ID */
export function deleteResourceByConnection(connectionId: string): void {
  db().delete(resourceTable).where(eq(resourceTable.connectionId, connectionId)).run()
}
