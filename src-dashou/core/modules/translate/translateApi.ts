/**
 * 翻译域的 core API。
 *
 * 契约：
 * 1. 实现内部抛 `TranslateError`，**只有 API 边界**把错误转成 `TranslateResult` 信封；
 * 2. 入参一律按 unknown 收窄，缺条目 ID 报 `invalidItem`；
 * 3. 本域的写操作只碰 `media_translation`（库内派生物）与日志；翻译可能调用多次外部插件，
 *    耗时可能超过宿主 30s 的单次调用上限，渲染层用长任务通道调它。
 */
import { readString, toSource } from '@common/types/setting/shared'
import {
  TranslateError,
  describeTranslateError,
  translateFail,
  translateOk,
  type TranslateClearResult,
  type TranslateItemRequest,
  type TranslateItemResult,
  type TranslateResult
} from '@common/types/translate'
import { clearItemTranslation, translateItem } from './itemTranslate'

function handle<T>(task: () => Promise<T> | T): Promise<TranslateResult<T>> {
  return Promise.resolve()
    .then(task)
    .then((data) => translateOk(data))
    .catch((error: unknown) => {
      const { code, message } = describeTranslateError(error)
      return translateFail(code, message)
    })
}

function payloadOf(payload: unknown): Record<string, unknown> {
  return toSource(payload) ?? {}
}

/** 条目 ID 必须是非空字符串 */
function readItemId(payload: unknown): string {
  const itemId = readString(payloadOf(payload), 'itemId', '').trim()
  if (itemId.length === 0) throw new TranslateError('invalidItem')
  return itemId
}

/** `pluginId` 缺省 / 非字符串都当空串（= 按设置自动挑插件） */
function readItemRequest(payload: unknown): TranslateItemRequest {
  return {
    itemId: readItemId(payload),
    pluginId: readString(payloadOf(payload), 'pluginId', '').trim()
  }
}

export const translateApi = {
  translateItem: (_ctx: unknown, payload: unknown): Promise<TranslateResult<TranslateItemResult>> =>
    handle<TranslateItemResult>(() => translateItem(readItemRequest(payload))),

  translateClear: (_ctx: unknown, payload: unknown): Promise<TranslateResult<TranslateClearResult>> =>
    handle<TranslateClearResult>(() => clearItemTranslation(readItemId(payload)))
}
