/**
 * 翻译字段的收集与合并（纯函数，不碰 IO）。
 *
 * 契约：
 * - 字段范围按产品口径固定为九组：标题、原名、简介、片商、厂牌、系列、导演、标签、演员名；
 * - **集条目只翻简介**（集标题按产品口径不翻译），所以其它字段对集一律留空；
 * - 空值不进清单：空串 / 空数组表示「没有原文」，不会产生一次翻译调用；
 * - `applyTranslation` 把译文叠加回插件详情（刮削写 NFO 用）：只有译文非空才覆盖原文，
 *   `tags` / `actors` 按**位置**对应原文，译文缺的位置保留原文。
 */
import type { PluginMovieDetail } from '@common/types/plugin'
import type { MediaItemTranslation } from '@common/types/translate'
import type { MediaItemRow } from '$/db/schema'
import { readItemMetadata } from '$/db/repo/mediaRepo'

/** 一个条目上待翻译的字段集合 */
export interface TranslateFields {
  title: string
  originalTitle: string
  overview: string
  maker: string
  label: string
  series: string
  director: string
  tags: string[]
  actors: string[]
}

/** 收集待翻译字段；`actors` 是按出演顺序的演员名（集条目用不到） */
export function collectFields(item: MediaItemRow, actors: readonly string[]): TranslateFields {
  if (item.type === 'episode') {
    return {
      title: '',
      originalTitle: '',
      overview: item.overview,
      maker: '',
      label: '',
      series: '',
      director: '',
      tags: [],
      actors: []
    }
  }
  return {
    title: item.name,
    originalTitle: item.originalTitle,
    overview: item.overview,
    maker: item.maker,
    label: item.label,
    series: item.series,
    director: item.director,
    tags: readItemMetadata(item).tags,
    actors: [...actors]
  }
}

/** 有原文的字段数（每个标签、每个演员名各算一项） */
export function countFields(fields: TranslateFields): number {
  const texts = [
    fields.title,
    fields.originalTitle,
    fields.overview,
    fields.maker,
    fields.label,
    fields.series,
    fields.director
  ]
  return texts.filter((text) => text.length > 0).length + fields.tags.length + fields.actors.length
}

/** 空的译文骨架：本次翻译的落库形状，字段逐个填 */
export function emptyTranslation(
  item: MediaItemRow,
  language: MediaItemTranslation['language'],
  sourceLanguage: MediaItemTranslation['sourceLanguage'],
  pluginId: string
): MediaItemTranslation {
  return {
    itemId: item.id,
    libraryId: item.libraryId,
    language,
    sourceLanguage,
    title: '',
    originalTitle: '',
    overview: '',
    maker: '',
    label: '',
    series: '',
    director: '',
    tags: [],
    actors: [],
    pluginId,
    translatedAt: Date.now()
  }
}

/** 按位置叠加：译文缺失的位置保留原文 */
function overlayList(original: readonly string[], translated: readonly string[]): string[] {
  if (translated.length === 0) return [...original]
  return original.map((text, index) => translated[index] || text)
}

/** 可选文本的叠加：译文非空才覆盖 */
function overlayText(original: string | undefined, translated: string): string | undefined {
  return translated.length > 0 ? translated : original
}

/** 把译文叠加回插件详情；`translation` 为 null 时原样返回 */
export function applyTranslation(
  detail: PluginMovieDetail,
  translation: MediaItemTranslation | null
): PluginMovieDetail {
  if (!translation) return detail
  return {
    ...detail,
    title: translation.title || detail.title,
    originalTitle: overlayText(detail.originalTitle, translation.originalTitle),
    plot: overlayText(detail.plot, translation.overview),
    maker: overlayText(detail.maker, translation.maker),
    label: overlayText(detail.label, translation.label),
    series: overlayText(detail.series, translation.series),
    director: overlayText(detail.director, translation.director),
    tags: detail.tags ? overlayList(detail.tags, translation.tags) : detail.tags,
    actors: detail.actors ? overlayList(detail.actors, translation.actors) : detail.actors
  }
}
