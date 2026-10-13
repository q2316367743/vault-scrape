/**
 * 翻译模块的 IPC 注册。
 *
 * 契约（沿用 media / scrape 域的写法）：
 * 1. 实现内部抛 `TranslateError`，**只有 IPC 边界**把错误转成 `TranslateResult` 信封；
 * 2. 入参一律按 unknown 从渲染层收窄，缺条目 ID 报 `invalidItem`；
 * 3. 本域的写操作只碰 `media_translation`（库内派生物）与日志，
 *    磁盘 NFO 由刮削链路在写文件时一次性带上译文，这里不重写文件。
 */
import { ipcMain } from 'electron'
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
import { TranslateChannels } from '~/modules/translate/translateChannels'
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

export function registerTranslateIpc(): void {
  ipcMain.handle(TranslateChannels.item, (_event, payload: unknown) =>
    handle<TranslateItemResult>(() => translateItem(readItemRequest(payload)))
  )
  ipcMain.handle(TranslateChannels.clear, (_event, payload: unknown) =>
    handle<TranslateClearResult>(() => clearItemTranslation(readItemId(payload)))
  )
}
