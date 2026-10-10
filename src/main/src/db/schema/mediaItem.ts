import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * 媒体条目表（Jellyfin 的 BaseItem）。
 *
 * 一个视频文件 = 一个 `movie` 条目；目录按需生成 `folder` 条目做父子层级。
 * 刮削元数据写在条目上，所以重扫只会更新媒体源、不会丢元数据。
 */
export const mediaItemTable = sqliteTable(
  'media_item',
  {
    id: text('id').primaryKey(),
    libraryId: text('library_id').notNull(),
    connectionId: text('connection_id').notNull(),
    /** 条目类型；本次只落地 movie / folder，series 等后续再接 */
    type: text('type').$type<'movie' | 'folder'>().notNull().default('movie'),
    /** 父条目 ID（目录层级），根下为连接内目录路径对应的 folder 或空串 */
    parentId: text('parent_id').notNull().default(''),
    /** 连接内绝对路径：movie 是主媒体源路径，folder 是目录路径 */
    path: text('path').notNull().default(''),
    name: text('name').notNull(),
    sortName: text('sort_name').notNull().default(''),
    originalTitle: text('original_title').notNull().default(''),
    /** 番号（刮削或文件名解析得到），识别不到为空串 */
    num: text('num').notNull().default(''),
    overview: text('overview').notNull().default(''),
    tagline: text('tagline').notNull().default(''),
    premiereDate: text('premiere_date').notNull().default(''),
    productionYear: integer('production_year').notNull().default(0),
    runtimeMinutes: integer('runtime_minutes').notNull().default(0),
    officialRating: text('official_rating').notNull().default(''),
    communityRating: integer('community_rating').notNull().default(0),
    /** 题材、制作公司、标签、外部 ID 一律 JSON 文本，读写走类型化转换 */
    genres: text('genres').notNull().default('[]'),
    studios: text('studios').notNull().default('[]'),
    tags: text('tags').notNull().default('[]'),
    providerIds: text('provider_ids').notNull().default('{}'),
    /** 上次命中的刮削器插件 ID */
    scraperId: text('scraper_id').notNull().default(''),
    /** 上次刮削完成时间；0 表示尚未刮削 */
    scrapedAt: integer('scraped_at').notNull().default(0),
    /**
     * 上次扫描时同目录有没有 NFO（`movie.nfo` 或与视频同名的 `.nfo`）；1 = 有。
     *
     * 这一列归**扫描**维护（刮削元数据列不归扫描管），用于「是否刮削」判定：
     * 磁盘上已经有刮削产出（NFO / 图片）时，即使没跑过刮削流程也算已刮削。
     */
    hasNfo: integer('has_nfo').notNull().default(0),
    dateAdded: integer('date_added').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (table) => [
    index('idx_media_item_library').on(table.libraryId),
    index('idx_media_item_parent').on(table.parentId),
    index('idx_media_item_library_conn_num').on(table.libraryId, table.connectionId, table.num)
  ]
)

export type MediaItemRow = typeof mediaItemTable.$inferSelect
export type MediaItemRowInsert = typeof mediaItemTable.$inferInsert
