import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { TaskStatus } from '@common/types/task'

/** 刮削任务表 */
export const taskTable = sqliteTable(
  'task',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    status: text('status').$type<TaskStatus>().notNull(),
    connectionId: text('connection_id').notNull().default(''),
    dirPath: text('dir_path').notNull().default(''),
    total: integer('total').notNull().default(0),
    finished: integer('finished').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    message: text('message').notNull().default(''),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (table) => [
    index('idx_task_status').on(table.status),
    index('idx_task_created').on(table.createdAt)
  ]
)

export type TaskRow = typeof taskTable.$inferSelect
export type TaskRowInsert = typeof taskTable.$inferInsert
