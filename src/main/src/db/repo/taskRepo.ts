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
  const stats: TaskStats = {
    total: 0,
    pending: 0,
    running: 0,
    success: 0,
    failed: 0,
    paused: 0,
    interrupted: 0
  }
  rows.forEach((row) => {
    stats[row.status] = row.value
    stats.total += row.value
  })
  return stats
}

export function getTask(id: string): TaskItem | null {
  return (
    db().select().from(taskTable).where(eq(taskTable.id, id)).get() ?? null
  )
}

export function insertTask(item: TaskItem): void {
  db().insert(taskTable).values(item).run()
}

/** 只更新传入的字段，调用方负责同时带上 `updatedAt` */
export function updateTask(id: string, patch: Partial<TaskItem>): void {
  db().update(taskTable).set(patch).where(eq(taskTable.id, id)).run()
}

/** 正在运行的任务数量：同一时刻只允许一个刮削任务 */
export function countRunningTask(): number {
  return countTask({ status: 'running' })
}

/** 应用启动时把上次残留的 running 任务标记为中断，返回处理条数 */
export function interruptRunningTasks(now: number): number {
  const rows = db()
    .update(taskTable)
    .set({ status: 'interrupted', message: '应用重启导致中断', updatedAt: now })
    .where(eq(taskTable.status, 'running'))
    .returning({ id: taskTable.id })
    .all()
  return rows.length
}
