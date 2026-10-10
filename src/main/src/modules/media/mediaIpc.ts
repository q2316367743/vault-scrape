/**
 * 影视墙模块的 IPC 注册。
 *
 * 契约（沿用 scrape / plugin 域的写法）：
 * 1. 模块内部抛 `MediaError`，**只有 IPC 边界**把错误转成 `MediaResult` 信封；
 * 2. 入参一律按 unknown 从渲染层收窄，缺字段抛 `invalidArgument`；
 * 3. 只读：影视墙与首页都不落盘、不触发刮削，也不改资源索引。
 */
import { ipcMain } from 'electron'
import {
  MediaError,
  describeMediaError,
  mediaFail,
  mediaOk,
  type MediaDetailRequest,
  type MediaDetailResult,
  type MediaHomeResult,
  type MediaResult,
  type MediaWallRequest,
  type MediaWallResult
} from '@common/types/media'
import { readString, toSource } from '@common/types/setting/shared'
import { MediaChannels } from '~/modules/media/mediaChannels'
import { loadMediaDetail, loadMediaHome, loadMediaWall } from './mediaWall'

function handle<T>(task: () => Promise<T> | T): Promise<MediaResult<T>> {
  return Promise.resolve()
    .then(task)
    .then((data) => mediaOk(data))
    .catch((error: unknown) => {
      const { code, message } = describeMediaError(error)
      return mediaFail(code, message)
    })
}

function payloadOf(payload: unknown): Record<string, unknown> {
  return toSource(payload) ?? {}
}

/** 详情入参：媒体条目 ID 必须是非空字符串 */
function readDetailRequest(payload: unknown): MediaDetailRequest {
  const itemId = readString(payloadOf(payload), 'itemId', '').trim()
  if (itemId.length === 0) throw new MediaError('invalidArgument', '缺少媒体条目 ID')
  return { itemId }
}

/** 墙面入参：`libraryId` 缺省 / 非字符串都当空串（= 全部资料库） */
function readWallRequest(payload: unknown): MediaWallRequest {
  return { libraryId: readString(payloadOf(payload), 'libraryId', '').trim() }
}

export function registerMediaIpc(): void {
  ipcMain.handle(MediaChannels.wall, (_event, payload: unknown) =>
    handle<MediaWallResult>(() => loadMediaWall(readWallRequest(payload)))
  )
  // 首页三排与墙面同源，同样只读
  ipcMain.handle(MediaChannels.home, () => handle<MediaHomeResult>(() => loadMediaHome()))
  ipcMain.handle(MediaChannels.detail, (_event, payload: unknown) =>
    handle<MediaDetailResult>(() => loadMediaDetail(readDetailRequest(payload)))
  )
}
