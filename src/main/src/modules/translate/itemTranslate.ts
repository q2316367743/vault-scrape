/**
 * 条目翻译的编排：读原文 → 逐字段调翻译插件 → 译文入库。
 *
 * 契约：
 * - **一次一个条目**：条目级用一个内存 `Set` 挡住并发（同一条目重复点只报 `busy`），
 *   字段级用 `CONCURRENCY` 条并发，别把插件的接口打爆；
 * - **译文是派生物**：整行覆盖（upsert），换目标语言 / 换插件重翻一遍即可，原文永远在 `media_item` 里；
 * - **剧集连带每一集**：剧集条目翻九组字段，随后按 `listSeriesEpisodes` 顺序把每一集也翻一遍
 *   （集只翻简介）；集条目自己也可以被单独翻，走的是同一条 `translateRow`；
 * - **源语言**取自资料库的「内容语言」，空串表示没设置 → 交给插件自动检测；
 *   目标语言取自 `setting.translate.targetLanguage`，与 `enabled` 无关（手动翻译不受开关影响）；
 * - 插件报错一律收敛成 `invokeFailed`（原文与详情只进日志），界面不出现插件内部术语。
 */
import { isTranslateLanguage, normalizeTranslateResult, describePluginError } from '@common/types/plugin'
import type { TranslateLanguage } from '@common/types/setting/translateSetting'
import {
  TranslateError,
  type MediaItemTranslation,
  type TranslateClearResult,
  type TranslateItemRequest,
  type TranslateItemResult
} from '@common/types/translate'
import { appendLog } from '$/db/repo/logRepo'
import { getLibrary } from '$/db/repo/libraryRepo'
import { listItemCastNames } from '$/db/repo/actorRepo'
import { getItem } from '$/db/repo/mediaRepo'
import type { MediaItemRow } from '$/db/schema'
import { listSeriesEpisodes } from '$/db/repo/mediaSeriesRepo'
import { deleteTranslation, upsertTranslation } from '$/db/repo/translationRepo'
import { translatePlugins } from '$/modules/plugin/pluginRegistries'
import { loadSetting } from '$/modules/setting/settingStore'
import { collectFields, countFields, emptyTranslation, type TranslateFields } from './translateFields'
import { pickTranslatePlugin } from './translatePlugins'

/** 字段级并发：一次条目最多同时挂 3 个翻译请求 */
const CONCURRENCY = 3

/** 正在翻译的条目 ID —— 同一条目不重复入队 */
const running = new Set<string>()

/** 这个条目现在正在翻译吗（详情页据此禁用按钮） */
export function isTranslating(itemId: string): boolean {
  return running.has(itemId)
}

/** 翻译一个条目；剧集连同它的每一集 */
export async function translateItem(request: TranslateItemRequest): Promise<TranslateItemResult> {
  const item = getItem(request.itemId)
  if (!item) throw new TranslateError('invalidItem')
  if (running.has(item.id)) throw new TranslateError('busy')
  running.add(item.id)
  try {
    return await runItem(item, (request.pluginId ?? '').trim())
  } finally {
    running.delete(item.id)
  }
}

/** 丢掉一个条目的译文 */
export function clearItemTranslation(itemId: string): TranslateClearResult {
  if (!getItem(itemId)) throw new TranslateError('invalidItem')
  return { itemId, removed: deleteTranslation(itemId) }
}

async function runItem(item: MediaItemRow, preferredId: string): Promise<TranslateItemResult> {
  const setting = loadSetting().translate
  const target = setting.targetLanguage
  const declared = getLibrary(item.libraryId)?.language ?? ''
  const source: TranslateLanguage | '' = isTranslateLanguage(declared) ? declared : ''
  const plugin = pickTranslatePlugin(preferredId.length > 0 ? preferredId : setting.pluginId)

  const own = await translateRow(item, plugin.id, source, target)
  let translatedCount = own.translatedCount
  let total = own.total
  if (item.type === 'series') {
    for (const episode of listSeriesEpisodes(item.libraryId, item.id)) {
      const row = getItem(episode.itemId)
      if (!row) continue
      const result = await translateRow(row, plugin.id, source, target)
      translatedCount += result.translatedCount
      total += result.total
    }
  }
  appendLog({
    level: 'info',
    scope: `translate:${plugin.id}`,
    message: `条目 ${item.id} 翻译完成：${translatedCount}/${total} 个字段`,
    detail: `target=${target} source=${source || 'auto'}`
  })
  return { itemId: item.id, language: target, translatedCount, total }
}

interface RowTranslationResult {
  translatedCount: number
  total: number
}

/** 翻一个条目的全部字段，成功后整行覆盖写回 */
async function translateRow(
  row: MediaItemRow,
  pluginId: string,
  source: TranslateLanguage | '',
  target: TranslateLanguage
): Promise<RowTranslationResult> {
  const fields = collectFields(row, row.type === 'episode' ? [] : listItemCastNames(row.id))
  const total = countFields(fields)
  if (total === 0) return { translatedCount: 0, total: 0 }

  const translation = emptyTranslation(row, target, source, pluginId)
  const slots = buildSlots(fields, translation)
  const done = await mapLimit(slots, CONCURRENCY, async (slot) => {
    const text = await translateText(slot.text, pluginId, source, target)
    slot.assign(text)
    return text.length > 0 && text !== slot.text
  })
  upsertTranslation(translation)
  return { translatedCount: done.filter(Boolean).length, total }
}

/** 一个字段的翻译任务：把结果写回译文对象的对应位置 */
interface TranslateSlot {
  text: string
  assign: (text: string) => void
}

function buildSlots(fields: TranslateFields, translation: MediaItemTranslation): TranslateSlot[] {
  const slots: TranslateSlot[] = []
  const push = (text: string, assign: (text: string) => void): void => {
    if (text.length > 0) slots.push({ text, assign })
  }
  push(fields.title, (text) => {
    translation.title = text
  })
  push(fields.originalTitle, (text) => {
    translation.originalTitle = text
  })
  push(fields.overview, (text) => {
    translation.overview = text
  })
  push(fields.maker, (text) => {
    translation.maker = text
  })
  push(fields.label, (text) => {
    translation.label = text
  })
  push(fields.series, (text) => {
    translation.series = text
  })
  push(fields.director, (text) => {
    translation.director = text
  })
  const tags = fields.tags.map(() => '')
  fields.tags.forEach((text, index) => {
    push(text, (value) => {
      tags[index] = value
    })
  })
  const actors = fields.actors.map(() => '')
  fields.actors.forEach((text, index) => {
    push(text, (value) => {
      actors[index] = value
    })
  })
  // 两个数组按位置原地填充，译文对象直接引用它们
  translation.tags = tags
  translation.actors = actors
  return slots
}

/** 调一次翻译插件；拿不到译文或插件报错都算 `invokeFailed`（细节只进日志） */
async function translateText(
  text: string,
  pluginId: string,
  source: TranslateLanguage | '',
  target: TranslateLanguage
): Promise<string> {
  let raw: unknown
  try {
    raw = await translatePlugins.invokePlugin(pluginId, 'translate', {
      text,
      from: source === '' ? undefined : source,
      to: target
    })
  } catch (error) {
    appendLog({
      level: 'warn',
      scope: `translate:${pluginId}`,
      message: `翻译调用失败：${describePluginError(error).message}`
    })
    throw new TranslateError('invokeFailed')
  }
  const result = normalizeTranslateResult(raw)
  if (!result || result.text.length === 0) {
    appendLog({ level: 'warn', scope: `translate:${pluginId}`, message: '插件没有返回译文' })
    throw new TranslateError('invokeFailed')
  }
  return result.text
}

/** 定并发跑一批任务，保持输入顺序返回 */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await task(items[index])
    }
  })
  await Promise.all(workers)
  return results
}
