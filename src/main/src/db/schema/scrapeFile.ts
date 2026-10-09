import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { ScrapeFileStatus } from '@common/types/scrape'

/** 逐文件刮削结果表：一个任务多行，渲染层按任务查询 */
export const scrapeFileTable = sqliteTable(
  'scrape_file',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    /** 扫描时的原始路径，任务内唯一 */
    path: text('path').notNull(),
    /**
     * 刮削结束后的最终路径。
     *
     * 未开启改名/移动时与 `path` 相同；开启后是文件在磁盘上的新位置，
     * 影视墙靠它把「磁盘上的视频」和「刮削记录」精确对齐。
     * 旧数据（本列上线前写入的行）为空串，读取方需要回落到 `path`。
     */
    finalPath: text('final_path').notNull().default(''),
    name: text('name').notNull().default(''),
    keyword: text('keyword').notNull().default(''),
    status: text('status').$type<ScrapeFileStatus>().notNull().default('pending'),
    pluginId: text('plugin_id').notNull().default(''),
    title: text('title').notNull().default(''),
    message: text('message').notNull().default(''),
    /** 封面资源 ID（可由 connectionId + path 复算），无封面时为空串 */
    coverId: text('cover_id').notNull().default(''),
    /** 封面在连接内的路径，无封面时为空串 */
    coverPath: text('cover_path').notNull().default(''),
    updatedAt: integer('updated_at').notNull()
  },
  (table) => [
    index('idx_scrape_file_task').on(table.taskId),
    index('idx_scrape_file_status').on(table.taskId, table.status)
  ]
)

export type ScrapeFileRow = typeof scrapeFileTable.$inferSelect
export type ScrapeFileRowInsert = typeof scrapeFileTable.$inferInsert
