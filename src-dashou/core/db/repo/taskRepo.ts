import type { TaskItem, TaskQuery, TaskStats } from '@common/types/task'
import { TASK_COLUMNS } from '../columns'
import { allOf, oneOf, runOf, type SqlValue } from '../query'

/** TaskItem 的 camelCase 键 → SQL 列名；只允许写这些列 */
const TASK_COLUMN_OF: Readonly<Record<keyof TaskItem, string>> = {
  id: 'id',
  name: 'name',
  status: 'status',
  connectionId: 'connection_id',
  dirPath: 'dir_path',
  total: 'total',
  finished: 'finished',
  failed: 'failed',
  message: 'message',
  createdAt: 'created_at',
  updatedAt: 'updated_at'
}

export function listTask(query: TaskQuery = {}): TaskItem[] {
  const params: SqlValue[] = []
  let where = ''
  if (query.status) {
    where = ' WHERE status = ?'
    params.push(query.status)
  }
  params.push(query.limit ?? 20, query.offset ?? 0)
  return allOf<TaskItem>(
    `SELECT ${TASK_COLUMNS} FROM task${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    params
  )
}

export function countTask(query: TaskQuery = {}): number {
  const params: SqlValue[] = []
  let where = ''
  if (query.status) {
    where = ' WHERE status = ?'
    params.push(query.status)
  }
  const row = oneOf<{ value: number }>(`SELECT count(*) AS value FROM task${where}`, params)
  return Number(row?.value ?? 0)
}

/** 概览统计：按状态聚合计数 */
export function taskStats(): TaskStats {
  const rows = allOf<{ status: string; value: number }>(
    'SELECT status, count(*) AS value FROM task GROUP BY status'
  )
  const stats: TaskStats = {
    total: 0,
    pending: 0,
    running: 0,
    success: 0,
    failed: 0,
    paused: 0,
    interrupted: 0
  }
  for (const row of rows) {
    if (row.status in stats) stats[row.status as keyof TaskStats] = Number(row.value)
    stats.total += Number(row.value)
  }
  return stats
}

export function getTask(id: string): TaskItem | null {
  return oneOf<TaskItem>(`SELECT ${TASK_COLUMNS} FROM task WHERE id = ?`, [id])
}

export function insertTask(item: TaskItem): void {
  runOf(
    `INSERT INTO task (id, name, status, connection_id, dir_path, total, finished, failed,
      message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.name,
      item.status,
      item.connectionId,
      item.dirPath,
      item.total,
      item.finished,
      item.failed,
      item.message,
      item.createdAt,
      item.updatedAt
    ]
  )
}

/** 只更新传入的字段，调用方负责同时带上 `updatedAt` */
export function updateTask(id: string, patch: Partial<TaskItem>): void {
  const sets: string[] = []
  const params: SqlValue[] = []
  for (const [key, value] of Object.entries(patch)) {
    const column = TASK_COLUMN_OF[key as keyof TaskItem]
    if (!column || value === undefined) continue
    sets.push(`${column} = ?`)
    params.push(value as SqlValue)
  }
  if (sets.length === 0) return
  params.push(id)
  runOf(`UPDATE task SET ${sets.join(', ')} WHERE id = ?`, params)
}

/** 正在运行的任务数量：同一时刻只允许一个刮削任务 */
export function countRunningTask(): number {
  return countTask({ status: 'running' })
}

/** 应用启动时把上次残留的 running 任务标记为中断，返回处理条数 */
export function interruptRunningTasks(now: number): number {
  return runOf(
    `UPDATE task SET status = 'interrupted', message = '应用重启导致中断', updated_at = ?
      WHERE status = 'running'`,
    [now]
  )
}
