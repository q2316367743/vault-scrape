/**
 * 条目译文仓储：`media_translation` 表的读写与行映射。
 *
 * 契约：
 * - 只做 SQL 与行映射，业务校验在 `$ /modules/translate`；
 * - 一行 = 一个条目的译文（`item_id` 是主键），所以写入一律是 upsert；
 * - `tags` / `actors` 是 JSON 文本列，解析失败回落空数组；
 * - `language` 脏数据（不在宿主 5 种语言码里）整行视为没有译文，读回 null ——
 *   译文是纯派生物，读不回来重翻一次即可，不必报错。
 */
import { eq, inArray } from 'drizzle-orm'
import { isTranslateLanguage } from '@common/types/plugin'
import type { MediaItemTranslation } from '@common/types/translate'
import { db } from '../client'
import { mediaTranslationTable } from '../schema'
import type { MediaTranslationRow, MediaTranslationRowInsert } from '../schema'

function parseStringArray(text: string): string[] {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

function toTranslation(row: MediaTranslationRow): MediaItemTranslation | null {
  if (!isTranslateLanguage(row.language)) return null
  return {
    itemId: row.itemId,
    libraryId: row.libraryId,
    language: row.language,
    sourceLanguage: isTranslateLanguage(row.sourceLanguage) ? row.sourceLanguage : '',
    title: row.title,
    originalTitle: row.originalTitle,
    overview: row.overview,
    maker: row.maker,
    label: row.label,
    series: row.series,
    director: row.director,
    tags: parseStringArray(row.tags),
    actors: parseStringArray(row.actors),
    pluginId: row.pluginId,
    translatedAt: row.translatedAt
  }
}

/** 取一个条目的译文；没有（或语言码已失效）时返回 null */
export function getTranslation(itemId: string): MediaItemTranslation | null {
  const row = db().select().from(mediaTranslationTable).where(eq(mediaTranslationTable.itemId, itemId)).get()
  return row ? toTranslation(row) : null
}

/**
 * 一次取回这批条目的译文，按 itemId 索引。
 *
 * 剧集详情一次要读剧集本身 + 全部集，所以必须有批量读。
 */
export function listTranslations(itemIds: readonly string[]): Map<string, MediaItemTranslation> {
  const grouped = new Map<string, MediaItemTranslation>()
  if (itemIds.length === 0) return grouped
  const rows = db()
    .select()
    .from(mediaTranslationTable)
    .where(inArray(mediaTranslationTable.itemId, [...itemIds]))
    .all()
  for (const row of rows) {
    const translation = toTranslation(row)
    if (translation) grouped.set(translation.itemId, translation)
  }
  return grouped
}

/** 写入（覆盖）一个条目的译文 */
export function upsertTranslation(input: MediaItemTranslation): void {
  const row: MediaTranslationRowInsert = {
    itemId: input.itemId,
    libraryId: input.libraryId,
    language: input.language,
    sourceLanguage: input.sourceLanguage,
    title: input.title,
    originalTitle: input.originalTitle,
    overview: input.overview,
    maker: input.maker,
    label: input.label,
    series: input.series,
    director: input.director,
    tags: JSON.stringify(input.tags),
    actors: JSON.stringify(input.actors),
    pluginId: input.pluginId,
    translatedAt: input.translatedAt
  }
  db()
    .insert(mediaTranslationTable)
    .values(row)
    .onConflictDoUpdate({ target: mediaTranslationTable.itemId, set: row })
    .run()
}

/** 删掉一个条目的译文；返回是否真的删掉了一行 */
export function deleteTranslation(itemId: string): boolean {
  return (
    db()
      .delete(mediaTranslationTable)
      .where(eq(mediaTranslationTable.itemId, itemId))
      .returning({ itemId: mediaTranslationTable.itemId })
      .all().length > 0
  )
}

/** 批量删掉这批条目的译文（条目被删 / 被清空刮削数据时连带清理） */
export function deleteTranslationsByItems(itemIds: readonly string[]): number {
  if (itemIds.length === 0) return 0
  return db()
    .delete(mediaTranslationTable)
    .where(inArray(mediaTranslationTable.itemId, [...itemIds]))
    .returning({ itemId: mediaTranslationTable.itemId })
    .all().length
}
