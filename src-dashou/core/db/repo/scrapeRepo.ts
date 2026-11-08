import type { ScrapeFileItem, ScrapeFileStatus } from '@common/types/scrape'
import { SCRAPE_FILE_COLUMNS } from '../columns'
import { allOf, oneOf, runOf, type SqlValue } from '../query'
import { transaction } from '../client'

export function insertScrapeFiles(items: readonly ScrapeFileItem[]): void {
  if (items.length === 0) return
  const sql = `INSERT INTO scrape_file (id, task_id, item_id, path, final_path, name, keyword,
    status, plugin_id, title, message, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  transaction(() => {
    for (const item of items) {
      runOf(sql, [
        item.id,
        item.taskId,
        item.itemId,
        item.path,
        item.finalPath,
        item.name,
        item.keyword,
        item.status,
        item.pluginId,
        item.title,
        item.message,
        item.updatedAt
      ])
    }
  })
}

/** ScrapeFileItem 的 camelCase 键 → SQL 列名 */
const SCRAPE_FILE_COLUMN_OF: Readonly<Record<keyof ScrapeFileItem, string>> = {
  id: 'id',
  taskId: 'task_id',
  itemId: 'item_id',
  path: 'path',
  finalPath: 'final_path',
  name: 'name',
  keyword: 'keyword',
  status: 'status',
  pluginId: 'plugin_id',
  title: 'title',
  message: 'message',
  updatedAt: 'updated_at'
}

export function updateScrapeFile(id: string, patch: Partial<ScrapeFileItem>): void {
  const sets: string[] = []
  const params: SqlValue[] = []
  for (const [key, value] of Object.entries(patch)) {
    const column = SCRAPE_FILE_COLUMN_OF[key as keyof ScrapeFileItem]
    if (!column || value === undefined) continue
    sets.push(`${column} = ?`)
    params.push(value as SqlValue)
  }
  if (sets.length === 0) return
  params.push(id)
  runOf(`UPDATE scrape_file SET ${sets.join(', ')} WHERE id = ?`, params)
}

/** 按插入顺序返回任务下的文件行 */
export function listScrapeFile(taskId: string): ScrapeFileItem[] {
  return allOf<ScrapeFileItem>(
    `SELECT ${SCRAPE_FILE_COLUMNS} FROM scrape_file WHERE task_id = ?
      ORDER BY updated_at ASC, path ASC`,
    [taskId]
  )
}

export function countScrapeFile(taskId: string, status?: ScrapeFileStatus): number {
  const params: SqlValue[] = [taskId]
  let where = 'task_id = ?'
  if (status) {
    where += ' AND status = ?'
    params.push(status)
  }
  const row = oneOf<{ value: number }>(
    `SELECT count(*) AS value FROM scrape_file WHERE ${where}`,
    params
  )
  return Number(row?.value ?? 0)
}

export function clearScrapeFile(taskId: string): void {
  runOf('DELETE FROM scrape_file WHERE task_id = ?', [taskId])
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
  const params: SqlValue[] = []
  let where = ''
  if (status) {
    where = ' WHERE f.status = ?'
    params.push(status)
  }
  const rows = allOf<ScrapeFileItem & { connectionId: string }>(
    `SELECT f.id, f.task_id AS taskId, f.item_id AS itemId, f.path, f.final_path AS finalPath,
      f.name, f.keyword, f.status, f.plugin_id AS pluginId, f.title, f.message,
      f.updated_at AS updatedAt, t.connection_id AS connectionId
     FROM scrape_file f INNER JOIN task t ON f.task_id = t.id${where}
     ORDER BY f.updated_at DESC`,
    params
  )
  return rows.map((row) => {
    const { connectionId, ...item } = row
    return { item: item as ScrapeFileItem, connectionId }
  })
}
