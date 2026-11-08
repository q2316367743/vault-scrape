/**
 * 影视墙域的 core API。
 *
 * 契约：
 * 1. 模块内部抛 `MediaError`，**只有 API 边界**把错误转成 `MediaResult` 信封；
 * 2. 入参一律按 unknown 收窄，缺字段抛 `invalidArgument`；
 * 3. 影视墙与首页只读；`mediaClearNfo` 是本域唯一的写入口。
 */
import {
  MediaError,
  describeMediaError,
  mediaFail,
  mediaOk,
  type MediaClearNfoRequest,
  type MediaClearNfoResult,
  type MediaDetailRequest,
  type MediaDetailResult,
  type MediaHomeResult,
  type MediaResult,
  type MediaWallRequest,
  type MediaWallResult
} from '@common/types/media'
import { readString, toSource } from '@common/types/setting/shared'
import { clearMediaNfo } from './mediaClearNfo'
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

/** 详情入参：媒体条目 ID 必须是非空字符串（详情与清除 NFO 共用） */
function readItemId(payload: unknown): string {
  const itemId = readString(payloadOf(payload), 'itemId', '').trim()
  if (itemId.length === 0) throw new MediaError('invalidArgument', '缺少媒体条目 ID')
  return itemId
}

function readDetailRequest(payload: unknown): MediaDetailRequest {
  return { itemId: readItemId(payload) }
}

function readClearNfoRequest(payload: unknown): MediaClearNfoRequest {
  return { itemId: readItemId(payload) }
}

/** 墙面入参：`libraryId` 缺省 / 非字符串都当空串（= 全部资料库） */
function readWallRequest(payload: unknown): MediaWallRequest {
  return { libraryId: readString(payloadOf(payload), 'libraryId', '').trim() }
}

export const mediaApi = {
  mediaWall: (_ctx: unknown, payload: unknown): Promise<MediaResult<MediaWallResult>> =>
    handle<MediaWallResult>(() => loadMediaWall(readWallRequest(payload))),

  mediaHome: (): Promise<MediaResult<MediaHomeResult>> =>
    handle<MediaHomeResult>(() => loadMediaHome()),

  mediaDetail: (_ctx: unknown, payload: unknown): Promise<MediaResult<MediaDetailResult>> =>
    handle<MediaDetailResult>(() => loadMediaDetail(readDetailRequest(payload))),

  mediaClearNfo: (_ctx: unknown, payload: unknown): Promise<MediaResult<MediaClearNfoResult>> =>
    handle<MediaClearNfoResult>(() => clearMediaNfo(readClearNfoRequest(payload)))
}
