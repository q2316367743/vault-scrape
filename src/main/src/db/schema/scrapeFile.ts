import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { ScrapeFileStatus } from '@common/types/scrape'

/** 逐文件刮削结果表：一个任务多行，渲染层按任务查询 */
export const scrapeFileTable = sqliteTable(
  'scrape_file',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    /** 本次刮削的条目 ID（`media_item.id`）；解析不到条目时为空串 */
    itemId: text('item_id').notNull().default(''),
    /** 扫描时的原始路径，任务内唯一 */
    path: text('path').notNull(),
    /**
     * 刮削结束后的最终路径。
     *
     * 未开启改名/移动时与 `path` 相同；开启后是文件在磁盘上的新位置，
     * `media_source.path` 会同步更新，两者始终一致。
     */
    finalPath: text('final_path').notNull().default(''),
    name: text('name').notNull().default(''),
    keyword: text('keyword').notNull().default(''),
    status: text('status').$type<ScrapeFileStatus>().notNull().default('pending'),
    pluginId: text('plugin_id').notNull().default(''),
    title: text('title').notNull().default(''),
    message: text('message').notNull().default(''),
    updatedAt: integer('updated_at').notNull()
  },
  (table) => [
    index('idx_scrape_file_task').on(table.taskId),
    index('idx_scrape_file_status').on(table.taskId, table.status),
    index('idx_scrape_file_item').on(table.itemId)
  ]
)

export type ScrapeFileRow = typeof scrapeFileTable.$inferSelect
export type ScrapeFileRowInsert = typeof scrapeFileTable.$inferInsert
