import { and, asc, count, desc, eq } from 'drizzle-orm'
import type { ScrapeFileItem, ScrapeFileStatus } from '@common/types/scrape'
import { db } from '../client'
import { scrapeFileTable, taskTable } from '../schema'

/** 扫描结束后一次性写入整批待刮削文件 */
export function insertScrapeFiles(items: readonly ScrapeFileItem[]): void {
  if (items.length === 0) return
  db().insert(scrapeFileTable).values([...items]).run()
}

export function updateScrapeFile(id: string, patch: Partial<ScrapeFileItem>): void {
  db().update(scrapeFileTable).set(patch).where(eq(scrapeFileTable.id, id)).run()
}

/** 按插入顺序返回任务下的文件行 */
export function listScrapeFile(taskId: string): ScrapeFileItem[] {
  return db()
    .select()
    .from(scrapeFileTable)
    .where(eq(scrapeFileTable.taskId, taskId))
    .orderBy(asc(scrapeFileTable.updatedAt), asc(scrapeFileTable.path))
    .all()
}

export function countScrapeFile(taskId: string, status?: ScrapeFileStatus): number {
  const row = db()
    .select({ value: count() })
    .from(scrapeFileTable)
    .where(
      status
        ? and(eq(scrapeFileTable.taskId, taskId), eq(scrapeFileTable.status, status))
        : eq(scrapeFileTable.taskId, taskId)
    )
    .get()
  return row?.value ?? 0
}

export function clearScrapeFile(taskId: string): void {
  db().delete(scrapeFileTable).where(eq(scrapeFileTable.taskId, taskId)).run()
}

/** 一条刮削记录 + 它所属任务的连接 ID（`scrape_file` 自己不带连接信息） */
export interface ScrapeRecordWithConnection {
  item: ScrapeFileItem
  connectionId: string
}

/**
 * 跨任务读取刮削记录，顺带把连接 ID 带出来。
 *
 * 用途：影视墙要把「磁盘上的视频」和「刮削成果」按路径对齐，
 * 而路径只有在同一个连接内才有意义，所以必须 join 任务表拿 `connection_id`。
 */
export function listScrapeWithConnection(status?: ScrapeFileStatus): ScrapeRecordWithConnection[] {
  return db()
    .select({ file: scrapeFileTable, connectionId: taskTable.connectionId })
    .from(scrapeFileTable)
    .innerJoin(taskTable, eq(scrapeFileTable.taskId, taskTable.id))
    .where(status ? eq(scrapeFileTable.status, status) : undefined)
    .orderBy(desc(scrapeFileTable.updatedAt))
    .all()
    .map((row) => ({ item: row.file, connectionId: row.connectionId }))
}
