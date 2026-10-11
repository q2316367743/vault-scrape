import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { ActorGender } from '@common/types/actor'
import type { ActorImageKind, ActorImageSource } from '@common/types/actor'

/**
 * 演员表：存的是**用户自己设定的演员资料**。
 *
 * 身份唯一键是 `name_key`（姓名归一化后的小写形式），换句话说「同名即同一人」；
 * 别名单独落在 `actor_alias`，抓取时先按姓名、再按别名匹配，都匹配不到才新建。
 */
export const actorTable = sqliteTable(
  'actor',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** 姓名归一化键（唯一）：NFKC + 折叠空白 + 小写 */
    nameKey: text('name_key').notNull(),
    gender: text('gender').$type<ActorGender>().notNull().default(''),
    /** 出生日期 `YYYY-MM-DD`；未设置为空串 */
    birthday: text('birthday').notNull().default(''),
    birthCountry: text('birth_country').notNull().default(''),
    birthProvince: text('birth_province').notNull().default(''),
    birthCity: text('birth_city').notNull().default(''),
    birthCounty: text('birth_county').notNull().default(''),
    /** 身高 / 三围（cm）；0 表示未设置 */
    height: integer('height').notNull().default(0),
    bust: integer('bust').notNull().default(0),
    waist: integer('waist').notNull().default(0),
    hip: integer('hip').notNull().default(0),
    /** 罩杯；未设置为空串 */
    cup: text('cup').notNull().default(''),
    tagline: text('tagline').notNull().default(''),
    sourceUrl: text('source_url').notNull().default(''),
    overview: text('overview').notNull().default(''),
    /** 用户标签（JSON 数组）；刮削**不会**写入这一列 */
    tags: text('tags').notNull().default('[]'),
    /** 头像对应的 `actor_image.id`；空串表示没有头像 */
    avatarImageId: text('avatar_image_id').notNull().default(''),
    /** 锁定后抓取只补空白字段，不覆盖已有内容 */
    locked: integer('locked', { mode: 'boolean' }).notNull().default(false),
    /** 上次命中的插件 ID；未抓取过为空串 */
    scraperId: text('scraper_id').notNull().default(''),
    scrapedAt: integer('scraped_at').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (table) => [
    uniqueIndex('idx_actor_name_key').on(table.nameKey),
    index('idx_actor_updated').on(table.updatedAt)
  ]
)

/** 演员别名：一个演员可以有多个别名，同一演员下别名不重复 */
export const actorAliasTable = sqliteTable(
  'actor_alias',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id').notNull(),
    alias: text('alias').notNull(),
    /** 别名归一化键，匹配用 */
    aliasKey: text('alias_key').notNull()
  },
  (table) => [
    uniqueIndex('idx_actor_alias_actor_key').on(table.actorId, table.aliasKey),
    index('idx_actor_alias_key').on(table.aliasKey)
  ]
)

/**
 * 演员图片表（头像与图集）。
 *
 * `id` 同时是私有协议的媒体 ID，对外地址形如 `storage://actor/{id}/{文件名}`；
 * `path` 是应用数据目录里的绝对路径，只在主进程内使用，不下发渲染层。
 */
export const actorImageTable = sqliteTable(
  'actor_image',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id').notNull(),
    kind: text('kind').$type<ActorImageKind>().notNull().default('photo'),
    /** 应用数据目录内的绝对路径 */
    path: text('path').notNull(),
    /** 原始文件名，用于地址尾段与展示 */
    name: text('name').notNull(),
    extname: text('extname').notNull().default(''),
    mime: text('mime').notNull().default(''),
    size: integer('size').notNull().default(0),
    width: integer('width').notNull().default(0),
    height: integer('height').notNull().default(0),
    /** 图片来源：用户导入 / 抓取下载 */
    source: text('source').$type<ActorImageSource>().notNull().default('user'),
    createdAt: integer('created_at').notNull()
  },
  (table) => [index('idx_actor_image_actor').on(table.actorId)]
)

/**
 * 影视条目 ↔ 演员的**弱关联**：只记演员名字（`name_key` 归一化后用于匹配），不记演员 ID。
 *
 * 理由：演员的身份唯一键就是姓名（见 `actor.name_key`），关联表再存一份 ID 只会在
 * 改名 / 删演员时产生悬挂行；名字本身就足以做双向查询。
 * `ordinal` 保留 NFO / 插件给出的出演顺序。
 */
export const mediaCastTable = sqliteTable(
  'media_cast',
  {
    itemId: text('item_id').notNull(),
    actorName: text('actor_name').notNull(),
    nameKey: text('name_key').notNull(),
    ordinal: integer('ordinal').notNull().default(0)
  },
  (table) => [
    primaryKey({ columns: [table.itemId, table.nameKey] }),
    index('idx_media_cast_name').on(table.nameKey)
  ]
)

export type ActorRow = typeof actorTable.$inferSelect
export type ActorRowInsert = typeof actorTable.$inferInsert
export type ActorAliasRow = typeof actorAliasTable.$inferSelect
export type ActorAliasRowInsert = typeof actorAliasTable.$inferInsert
export type ActorImageRow = typeof actorImageTable.$inferSelect
export type ActorImageRowInsert = typeof actorImageTable.$inferInsert
export type MediaCastRow = typeof mediaCastTable.$inferSelect
export type MediaCastRowInsert = typeof mediaCastTable.$inferInsert
