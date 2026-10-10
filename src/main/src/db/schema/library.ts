import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { LibraryType } from '@common/types/library'

/**
 * 资料库表（Jellyfin 的 Library）：
 * 刮削器、扫描/刮削选项与统计时间都挂在库上，存储只负责怎么连；
 * 刮削器**可以为空**，空数组表示这个库只扫描、不刮削。
 *
 * 刮削产物形态（同名文件夹、必写 NFO、图片与影片同目录）是全局固定规范，
 * 因此没有对应的开关列；库上只保留「过滤多小的文件」与「是否优先用本地信息」。
 */
export const libraryTable = sqliteTable('library', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** 库类型；历史数据缺列时按默认值回落「影视」 */
  type: text('type').$type<LibraryType>().notNull().default('movie'),
  /** 刮削器插件 ID 列表（JSON 数组）；**空数组表示该库不刮削** */
  scrapers: text('scrapers').notNull().default('[]'),
  nsfwProtection: integer('nsfw_protection', { mode: 'boolean' }).notNull().default(true),
  /** 扫描时排除小于该体积（MB）的视频；0 表示不过滤 */
  minFileSizeMb: integer('min_file_size_mb').notNull().default(0),
  /** 优先读取本地 NFO 与本地图片，只从互联网上补缺失的信息 */
  localFirst: integer('local_first', { mode: 'boolean' }).notNull().default(false),
  moveEnabled: integer('move_enabled', { mode: 'boolean' }).notNull().default(false),
  moveDirectory: text('move_directory').notNull().default(''),
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
