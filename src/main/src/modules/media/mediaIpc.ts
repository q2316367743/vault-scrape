/**
 * 影视墙模块的 IPC 注册。
 *
 * 契约（沿用 scrape / plugin 域的写法）：
 * 1. 模块内部抛 `MediaError`，**只有 IPC 边界**把错误转成 `MediaResult` 信封；
 * 2. 入参一律按 unknown 从渲染层收窄，缺字段抛 `invalidArgument`；
 * 3. 只读：影视墙不落盘、不触发刮削，也不改资源索引。
 */
import { ipcMain } from 'electron'
import {
  MediaError,
  describeMediaError,
  mediaFail,
  mediaOk,
  type MediaDetailRequest,
  type MediaDetailResult,
  type MediaResult,
  type MediaWallResult
} from '@common/types/media'
import { toSource } from '@common/types/setting/shared'
import { MediaChannels } from '~/modules/media/mediaChannels'
import { loadMediaDetail, loadMediaWall } from './mediaWall'

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

/** 详情入参：连接 ID 与视频路径都必须是非空字符串 */
function readDetailRequest(payload: unknown): MediaDetailRequest {
  const source = payloadOf(payload)
  const connectionId = source.connectionId
  const path = source.path
  if (typeof connectionId !== 'string' || connectionId.trim().length === 0) {
    throw new MediaError('invalidArgument', '缺少数据源')
  }
  if (typeof path !== 'string' || path.trim().length === 0) {
    throw new MediaError('invalidArgument', '缺少视频路径')
  }
  return { connectionId, path }
}

export function registerMediaIpc(): void {
  ipcMain.handle(MediaChannels.wall, () => handle<MediaWallResult>(() => loadMediaWall()))
  ipcMain.handle(MediaChannels.detail, (_event, payload: unknown) =>
    handle<MediaDetailResult>(() => loadMediaDetail(readDetailRequest(payload)))
  )
}
