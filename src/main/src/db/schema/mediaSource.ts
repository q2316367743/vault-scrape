import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * 媒体源表（Jellyfin 的 MediaSource）。
 *
 * 一行 = 磁盘上的一个视频文件。ID 是 UUID，**改名/移动后由刮削任务就地更新 `path`，ID 不变**，
 * 因此 `storage://` 地址与远端缓存不会因为整理文件而失效。
 */
export const mediaSourceTable = sqliteTable(
  'media_source',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id').notNull(),
    libraryId: text('library_id').notNull(),
    connectionId: text('connection_id').notNull(),
    /** 连接内绝对路径 */
    path: text('path').notNull(),
    name: text('name').notNull(),
    extname: text('extname').notNull().default(''),
    mime: text('mime').notNull().default(''),
    size: integer('size').notNull().default(0),
    modifiedAt: integer('modified_at').notNull().default(0),
    indexedAt: integer('indexed_at').notNull(),
    /** 最后一次扫描它的批次 ID：扫描结束按它清理磁盘上已消失的行 */
    scanId: text('scan_id').notNull().default('')
  },
  (table) => [
    index('idx_media_source_item').on(table.itemId),
    index('idx_media_source_library').on(table.libraryId),
    uniqueIndex('idx_media_source_conn_path').on(table.connectionId, table.path)
  ]
)

export type MediaSourceRow = typeof mediaSourceTable.$inferSelect
export type MediaSourceRowInsert = typeof mediaSourceTable.$inferInsert
