import { and, asc, count, desc, eq } from 'drizzle-orm'
import type { ScrapeFileItem, ScrapeFileStatus } from '@common/types/scrape'
import { db } from '../client'
import { scrapeFileTable } from '../schema'

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

/**
 * 按封面资源 ID 反查最近一条结果行。
 *
 * 用途：资源索引被重建或清空时，私有协议仍能靠结果行兜底解析封面路径。
 */
export function findScrapeFileByCoverId(coverId: string): ScrapeFileItem | null {
  if (coverId.length === 0) return null
  return (
    db()
      .select()
      .from(scrapeFileTable)
      .where(eq(scrapeFileTable.coverId, coverId))
      .orderBy(desc(scrapeFileTable.updatedAt))
      .limit(1)
      .get() ?? null
  )
}
