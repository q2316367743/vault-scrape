import { count, desc, eq } from 'drizzle-orm'
import type { TaskItem, TaskQuery, TaskStats } from '@common/types/task'
import { db } from '../client'
import { taskTable } from '../schema'

export function listTask(query: TaskQuery = {}): TaskItem[] {
  return db()
    .select()
    .from(taskTable)
    .where(query.status ? eq(taskTable.status, query.status) : undefined)
    .orderBy(desc(taskTable.createdAt))
    .limit(query.limit ?? 20)
    .offset(query.offset ?? 0)
    .all()
}

export function countTask(query: TaskQuery = {}): number {
  const row = db()
    .select({ value: count() })
    .from(taskTable)
    .where(query.status ? eq(taskTable.status, query.status) : undefined)
    .get()
  return row?.value ?? 0
}

/** 概览统计：按状态聚合计数 */
export function taskStats(): TaskStats {
  const rows = db()
    .select({ status: taskTable.status, value: count() })
    .from(taskTable)
    .groupBy(taskTable.status)
    .all()
  const stats: TaskStats = { total: 0, pending: 0, running: 0, success: 0, failed: 0 }
  rows.forEach((row) => {
    stats[row.status] = row.value
    stats.total += row.value
  })
  return stats
}
