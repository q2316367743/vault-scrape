/**
 * 影视墙模块桥：所有调用返回 `MediaResult` 信封。
 */
import type {
  MediaClearNfoRequest,
  MediaClearNfoResult,
  MediaDetailRequest,
  MediaDetailResult,
  MediaHomeResult,
  MediaResult,
  MediaWallRequest,
  MediaWallResult
} from '@common/types/media'
import { callCore } from './invoke'
import { runJob } from './job'

export const mediaApi = {
  /** 拉取整面墙；不传请求时等价于「全部资料库」 */
  wall: (request: MediaWallRequest = { libraryId: '' }): Promise<MediaResult<MediaWallResult>> =>
    callCore('mediaWall', request),

  /** 拉取首页读模型（库摘要 + 最近添加 / 推荐两排） */
  home: (): Promise<MediaResult<MediaHomeResult>> => callCore('mediaHome'),

  /** 拉取单个视频的详情与 NFO 元信息 */
  detail: (request: MediaDetailRequest): Promise<MediaResult<MediaDetailResult>> =>
    callCore('mediaDetail', request),

  /** 清除单个视频的刮削数据与磁盘 NFO（会删文件，走长任务通道） */
  clearNfo: (request: MediaClearNfoRequest): Promise<MediaResult<MediaClearNfoResult>> =>
    runJob('media.clearNfo', request)
}

export type MediaApi = typeof mediaApi
