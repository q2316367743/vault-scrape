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
import { isTranslateLanguage } from '@common/types/plugin'
import type { MediaItemTranslation } from '@common/types/translate'
import { MEDIA_TRANSLATION_COLUMNS } from '../columns'
import { allOf, oneOf, runOf, placeholders, type SqlValue } from '../query'
import type { MediaTranslationRow } from '../schema'

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
  const row = oneOf<MediaTranslationRow>(
    `SELECT ${MEDIA_TRANSLATION_COLUMNS} FROM media_translation WHERE item_id = ?`,
    [itemId]
  )
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
  const rows = allOf<MediaTranslationRow>(
    `SELECT ${MEDIA_TRANSLATION_COLUMNS} FROM media_translation
      WHERE item_id IN (${placeholders(itemIds.length)})`,
    [...itemIds]
  )
  for (const row of rows) {
    const translation = toTranslation(row)
    if (translation) grouped.set(translation.itemId, translation)
  }
  return grouped
}

/** 写入（覆盖）一个条目的译文 */
export function upsertTranslation(input: MediaItemTranslation): void {
  runOf(
    `INSERT INTO media_translation (item_id, library_id, language, source_language, title,
      original_title, overview, maker, label, series, director, tags, actors, plugin_id,
      translated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET
      library_id = excluded.library_id,
      language = excluded.language,
      source_language = excluded.source_language,
      title = excluded.title,
      original_title = excluded.original_title,
      overview = excluded.overview,
      maker = excluded.maker,
      label = excluded.label,
      series = excluded.series,
      director = excluded.director,
      tags = excluded.tags,
      actors = excluded.actors,
      plugin_id = excluded.plugin_id,
      translated_at = excluded.translated_at`,
    [
      input.itemId,
      input.libraryId,
      input.language,
      input.sourceLanguage,
      input.title,
      input.originalTitle,
      input.overview,
      input.maker,
      input.label,
      input.series,
      input.director,
      JSON.stringify(input.tags),
      JSON.stringify(input.actors),
      input.pluginId,
      input.translatedAt
    ]
  )
}

/** 删掉一个条目的译文；返回是否真的删掉了一行 */
export function deleteTranslation(itemId: string): boolean {
  return runOf('DELETE FROM media_translation WHERE item_id = ?', [itemId]) > 0
}

/** 批量删掉这批条目的译文（条目被删 / 被清空刮削数据时连带清理） */
export function deleteTranslationsByItems(itemIds: readonly string[]): number {
  if (itemIds.length === 0) return 0
  return runOf(
    `DELETE FROM media_translation WHERE item_id IN (${placeholders(itemIds.length)})`,
    [...itemIds] as SqlValue[]
  )
}
