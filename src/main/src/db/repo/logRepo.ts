import { randomUUID } from 'crypto'
import { count, desc, eq } from 'drizzle-orm'
import type { LogInput, LogItem, LogQuery } from '@common/types/log'
import { db } from '../client'
import { logTable } from '../schema'

export function appendLog(input: LogInput): LogItem {
  const item: LogItem = {
    id: randomUUID(),
    level: input.level,
    scope: input.scope,
    message: input.message,
    detail: input.detail ?? '',
    createdAt: Date.now()
  }
  db().insert(logTable).values(item).run()
  return item
}

export function listLog(query: LogQuery = {}): LogItem[] {
  return db()
    .select()
    .from(logTable)
    .where(query.level ? eq(logTable.level, query.level) : undefined)
    .orderBy(desc(logTable.createdAt))
    .limit(query.limit ?? 50)
    .offset(query.offset ?? 0)
    .all()
}

export function countLog(query: LogQuery = {}): number {
  const row = db()
    .select({ value: count() })
    .from(logTable)
    .where(query.level ? eq(logTable.level, query.level) : undefined)
    .get()
  return row?.value ?? 0
}

export function clearLog(): number {
  return db().delete(logTable).run().changes
}
