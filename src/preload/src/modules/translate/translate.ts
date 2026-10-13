import { ipcRenderer } from 'electron'
import type {
  TranslateClearRequest,
  TranslateClearResult,
  TranslateItemRequest,
  TranslateItemResult,
  TranslateResult
} from '@common/types/translate'
import { TranslateChannels } from './translateChannels'

/**
 * 翻译模块桥。
 *
 * 契约：两个 invoke 都返回 `TranslateResult` 信封而**不抛异常**
 * （contextBridge 传递自定义错误的附加属性并不可靠，code 会丢失）。
 */
export const translateApi = {
  /** 翻译一个条目：译文覆盖同一个条目的旧译文；剧集会连同每一集的简介一起翻 */
  item: (request: TranslateItemRequest): Promise<TranslateResult<TranslateItemResult>> =>
    ipcRenderer.invoke(TranslateChannels.item, request),

  /** 丢掉一个条目的译文，详情页回到原文 */
  clear: (request: TranslateClearRequest): Promise<TranslateResult<TranslateClearResult>> =>
    ipcRenderer.invoke(TranslateChannels.clear, request)
}

export type TranslateApi = typeof translateApi
