import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { ResourceKind } from '@common/types/resource'

/**
 * 资源索引表：扫描媒体库时把该目录下的文件登记进来。
 *
 * 契约：
 * - 资源 ID = 「存储 ID + 连接内绝对路径」的哈希，同一文件重复扫描得到同一行（幂等替换）；
 * - 索引只用于「把 ID 换成真实路径」，不参与刮削判定；表清空也不影响已刮削的封面（有兜底解析）。
 */
export const resourceTable = sqliteTable(
  'resource',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id').notNull(),
    /** 建立索引时所在的目录（媒体库根目录） */
    dirPath: text('dir_path').notNull(),
    /** 连接内绝对路径 */
    path: text('path').notNull(),
    name: text('name').notNull(),
    extname: text('extname').notNull().default(''),
    mime: text('mime').notNull().default(''),
    size: integer('size').notNull().default(0),
    modifiedAt: integer('modified_at').notNull().default(0),
    kind: text('kind').$type<ResourceKind>().notNull().default('other'),
    indexedAt: integer('indexed_at').notNull()
  },
  (table) => [
    index('idx_resource_dir').on(table.connectionId, table.dirPath),
    uniqueIndex('idx_resource_conn_path').on(table.connectionId, table.path)
  ]
)

export type ResourceRow = typeof resourceTable.$inferSelect
export type ResourceRowInsert = typeof resourceTable.$inferInsert
