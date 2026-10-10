import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { LibraryImageSaveMode, LibraryType } from '@common/types/library'

/**
 * 资料库表（Jellyfin 的 Library）：
 * 刮削器、扫描/刮削选项与统计时间都挂在库上，存储只负责怎么连；
 * 刮削器**可以为空**，空数组表示这个库只扫描、不刮削。
 */
export const libraryTable = sqliteTable('library', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** 库类型；历史数据缺列时按默认值回落「影视」 */
  type: text('type').$type<LibraryType>().notNull().default('movie'),
  /** 刮削器插件 ID 列表（JSON 数组）；**空数组表示该库不刮削** */
  scrapers: text('scrapers').notNull().default('[]'),
  nsfwProtection: integer('nsfw_protection', { mode: 'boolean' }).notNull().default(true),
  writeNfo: integer('write_nfo', { mode: 'boolean' }).notNull().default(true),
  renameEnabled: integer('rename_enabled', { mode: 'boolean' }).notNull().default(false),
  moveEnabled: integer('move_enabled', { mode: 'boolean' }).notNull().default(false),
  moveDirectory: text('move_directory').notNull().default(''),
  imageSaveMode: text('image_save_mode').$type<LibraryImageSaveMode>().notNull().default('media'),
  lastScanAt: integer('last_scan_at').notNull().default(0),
  lastScrapeAt: integer('last_scrape_at').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

/**
 * 资料库的媒体目录（Jellyfin 的 LibraryPath）。
 * 一个库可以挂多个目录；同一条「连接 + 路径」不允许出现在两个库里。
 */
export const libraryPathTable = sqliteTable(
  'library_path',
  {
    id: text('id').primaryKey(),
    libraryId: text('library_id').notNull(),
    connectionId: text('connection_id').notNull(),
    /** 连接内绝对路径，`/` 表示连接根 */
    path: text('path').notNull(),
    createdAt: integer('created_at').notNull()
  },
  (table) => [
    index('idx_library_path_library').on(table.libraryId),
    uniqueIndex('idx_library_path_conn_path').on(table.connectionId, table.path)
  ]
)

export type LibraryRow = typeof libraryTable.$inferSelect
export type LibraryRowInsert = typeof libraryTable.$inferInsert
export type LibraryPathRow = typeof libraryPathTable.$inferSelect
export type LibraryPathRowInsert = typeof libraryPathTable.$inferInsert
