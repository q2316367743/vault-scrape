import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { MediaImageType } from '@common/types/media'

/**
 * 条目图片表（Jellyfin 的 ImageInfo）。
 *
 * 一行 = 挂在某个条目下的一张图（本机刮削产物或随片图片），
 * 私有协议用 `id` 定位，渲染层直接把地址喂给 img。
 */
export const mediaImageTable = sqliteTable(
  'media_image',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id').notNull(),
    libraryId: text('library_id').notNull(),
    type: text('type').$type<MediaImageType>().notNull().default('primary'),
    connectionId: text('connection_id').notNull(),
    /** 连接内绝对路径 */
    path: text('path').notNull(),
    width: integer('width').notNull().default(0),
    height: integer('height').notNull().default(0),
    createdAt: integer('created_at').notNull()
  },
  (table) => [
    index('idx_media_image_item').on(table.itemId),
    index('idx_media_image_library').on(table.libraryId),
    uniqueIndex('idx_media_image_conn_path').on(table.connectionId, table.path)
  ]
)

export type MediaImageRow = typeof mediaImageTable.$inferSelect
export type MediaImageRowInsert = typeof mediaImageTable.$inferInsert
