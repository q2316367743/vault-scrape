import { randomUUID } from 'node:crypto'
import type { LogInput, LogItem, LogQuery } from '@common/types/log'
import { LOG_COLUMNS } from '../columns'
import { allOf, oneOf, runOf, type SqlValue } from '../query'

export function appendLog(input: LogInput): LogItem {
  const item: LogItem = {
    id: randomUUID(),
    level: input.level,
    scope: input.scope,
    message: input.message,
    detail: input.detail ?? '',
    createdAt: Date.now()
  }
  runOf(
    'INSERT INTO log (id, level, scope, message, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [item.id, item.level, item.scope, item.message, item.detail, item.createdAt]
  )
  return item
}

export function listLog(query: LogQuery = {}): LogItem[] {
  const params: SqlValue[] = []
  let where = ''
  if (query.level) {
    where = ' WHERE level = ?'
    params.push(query.level)
  }
  params.push(query.limit ?? 50, query.offset ?? 0)
  return allOf<LogItem>(
    `SELECT ${LOG_COLUMNS} FROM log${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    params
  )
}

export function countLog(query: LogQuery = {}): number {
  const params: SqlValue[] = []
  let where = ''
  if (query.level) {
    where = ' WHERE level = ?'
    params.push(query.level)
  }
  const row = oneOf<{ value: number }>(`SELECT count(*) AS value FROM log${where}`, params)
  return Number(row?.value ?? 0)
}

export function clearLog(): number {
  return runOf('DELETE FROM log')
}
