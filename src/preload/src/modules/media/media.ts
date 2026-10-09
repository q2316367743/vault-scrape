import { ipcRenderer } from 'electron'
import type {
  MediaDetailRequest,
  MediaDetailResult,
  MediaResult,
  MediaWallResult
} from '@common/types/media'
import { MediaChannels } from './mediaChannels'

/**
 * 影视墙模块桥。
 *
 * 契约：所有 invoke 都返回 `MediaResult` 信封而**不抛异常**
 * （contextBridge 传递自定义错误的附加属性并不可靠，code 会丢失）。
 */
export const mediaApi = {
  /** 拉取整面墙 */
  wall: (): Promise<MediaResult<MediaWallResult>> => ipcRenderer.invoke(MediaChannels.wall),

  /** 拉取单个视频的详情与 NFO 元信息 */
  detail: (request: MediaDetailRequest): Promise<MediaResult<MediaDetailResult>> =>
    ipcRenderer.invoke(MediaChannels.detail, request)
}

export type MediaApi = typeof mediaApi
