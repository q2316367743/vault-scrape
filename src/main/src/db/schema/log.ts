import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { LogLevel } from '@common/types/log'

/** 运行日志表：写入即追加，按时间倒序读 */
export const logTable = sqliteTable(
  'log',
  {
    id: text('id').primaryKey(),
    level: text('level').$type<LogLevel>().notNull(),
    scope: text('scope').notNull(),
    message: text('message').notNull(),
    detail: text('detail').notNull().default(''),
    createdAt: integer('created_at').notNull()
  },
  (table) => [
    index('idx_log_created').on(table.createdAt),
    index('idx_log_level').on(table.level)
  ]
)

export type LogRow = typeof logTable.$inferSelect
export type LogRowInsert = typeof logTable.$inferInsert
