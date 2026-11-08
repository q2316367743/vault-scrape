/**
 * 刮削后的自动翻译：由刮削任务在写回元数据、演员名单之后调用一次。
 *
 * 触发条件（三条同时成立才做）：
 * 1. 设置里的「是否启用翻译」打开；
 * 2. 资料库声明了「内容语言」——没声明就没有可比对的源语言，不做自动翻译；
 * 3. 资料库语言与 `setting.translate.targetLanguage` 不同（相同就是白翻一遍）。
 *
 * 契约：
 * - 只负责编排与失败兜底，真正的翻译在 `itemTranslate`（剧集连带每一集）；
 * - **失败只记日志、返回 null**：翻译是锦上添花，绝不能让刮削结果变成失败；
 * - 译文的落盘由调用方决定（`translateNfo` 的 `writeTranslatedNfo`，受「写入 NFO」开关控制）。
 */
import { isTranslateLanguage } from '@common/types/plugin'
import type { MediaItemTranslation } from '@common/types/translate'
import { getLibrary } from '$/db/repo/libraryRepo'
import { getTranslation } from '$/db/repo/translationRepo'
import { loadSetting } from '$/modules/setting/settingStore'
import { isTranslating, translateItem } from './itemTranslate'
import type { TranslateLogSink } from './translateNfo'

/** 这个资料库现在需要自动翻译吗（库语言与目标语言一致、或库没声明语言都不需要） */
export function shouldAutoTranslate(libraryId: string): boolean {
  const setting = loadSetting().translate
  if (!setting.enabled) return false
  const declared = getLibrary(libraryId)?.language ?? ''
  if (!isTranslateLanguage(declared)) return false
  return declared !== setting.targetLanguage
}

/** 自动翻译一个条目：不需要、已在翻、翻失败都返回 null */
export async function autoTranslateItem(
  itemId: string,
  libraryId: string,
  log: TranslateLogSink
): Promise<MediaItemTranslation | null> {
  if (!shouldAutoTranslate(libraryId)) return null
  if (isTranslating(itemId)) return null
  try {
    await translateItem({ itemId })
    return getTranslation(itemId)
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    log.warn(`自动翻译失败（条目 ${itemId}）：${message}`)
    return null
  }
}
