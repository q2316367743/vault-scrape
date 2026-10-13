import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { TranslateLanguage } from '@common/types/setting/translateSetting'

/**
 * 条目译文表。
 *
 * 一行 = 一个条目的译文（`item_id` 唯一），语言只存一份：换目标语言就整行重写。
 *
 * 契约（详见 docs/plugin/10-translate-integration.md）：
 * - **原文不在这里**：`media_item` 各列才是原文，本表只是派生物，
 *   所以重新刮削、换语言、换插件都可以直接删掉重算，不会伤到原文；
 * - 剧集的每一集是独立条目、各占一行，且只填 `overview`（集标题不翻译）；
 * - `tags` / `actors` 是 JSON 文本数组，**按位置对应原文**（顺序即读取顺序），
 *   所以不建外键、不按名字关联——演员名是弱关联键（`media_cast`），改名会破坏关联，只允许译在展示层。
 */
export const mediaTranslationTable = sqliteTable(
  'media_translation',
  {
    itemId: text('item_id').primaryKey(),
    libraryId: text('library_id').notNull(),
    /** 译文语言（宿主 5 种语言码之一） */
    language: text('language').$type<TranslateLanguage>().notNull(),
    /** 翻译时的源语言；空串表示由插件自动检测 */
    sourceLanguage: text('source_language').notNull().default(''),
    title: text('title').notNull().default(''),
    originalTitle: text('original_title').notNull().default(''),
    overview: text('overview').notNull().default(''),
    maker: text('maker').notNull().default(''),
    label: text('label').notNull().default(''),
    series: text('series').notNull().default(''),
    director: text('director').notNull().default(''),
    /** 标签译文（JSON 文本数组，按位置对应原文） */
    tags: text('tags').notNull().default('[]'),
    /** 演员名译文（JSON 文本数组，按位置对应 `media_cast` 的读取顺序） */
    actors: text('actors').notNull().default('[]'),
    /** 产出这份译文的插件 ID */
    pluginId: text('plugin_id').notNull().default(''),
    /** 翻译完成时间；0 表示未知 */
    translatedAt: integer('translated_at').notNull().default(0)
  },
  (table) => [index('idx_media_translation_library').on(table.libraryId)]
)

export type MediaTranslationRow = typeof mediaTranslationTable.$inferSelect
export type MediaTranslationRowInsert = typeof mediaTranslationTable.$inferInsert
