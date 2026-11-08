/**
 * 翻译模块桥：两个调用返回 `TranslateResult` 信封。
 *
 * 译文是**库内派生物**：只翻一个条目 / 丢掉一个条目的译文；
 * 翻译插件自身的增删改查走 `pluginApi.translate`。
 */
import type {
  TranslateClearRequest,
  TranslateClearResult,
  TranslateItemRequest,
  TranslateItemResult,
  TranslateResult
} from '@common/types/translate'
import { callCore } from './invoke'
import { runJob } from './job'

export const translateApi = {
  /** 翻译一个条目（可能调用多次外部插件，走长任务通道） */
  item: (request: TranslateItemRequest): Promise<TranslateResult<TranslateItemResult>> =>
    runJob('translate.item', request),

  /** 丢掉一个条目的译文，详情页回到原文 */
  clear: (request: TranslateClearRequest): Promise<TranslateResult<TranslateClearResult>> =>
    callCore('translateClear', request)
}

export type TranslateApi = typeof translateApi
