/**
 * 演员模块桥：所有调用都返回 `ActorResult` 信封，不抛异常（与旧 preload 桥一致）。
 */
import type {
  ActorDetailRequest,
  ActorDetailResult,
  ActorImageImportRequest,
  ActorImageImportResult,
  ActorImageRequest,
  ActorListRequest,
  ActorListResult,
  ActorRemoveRequest,
  ActorResult,
  ActorSaveRequest,
  ActorSaveResult,
  ActorScrapeMissingResult,
  ActorScrapeRequest,
  ActorScrapeResult,
  ActorScrapeStatus
} from '@common/types/actor'
import { CORE_EVENTS } from '@common/channels'
import { subscribe } from './events'
import { callCore } from './invoke'
import { runJob } from './job'

export const actorApi = {
  /** 演员列表：关键词 / 标签筛选 + 排序 + 分页 */
  list: (request: ActorListRequest): Promise<ActorResult<ActorListResult>> =>
    callCore('actorList', request),

  /** 演员详情：资料 + 该演员全部出演作品 */
  detail: (request: ActorDetailRequest): Promise<ActorResult<ActorDetailResult>> =>
    callCore('actorDetail', request),

  /** 新增（`actorId` 空）或更新演员 */
  save: (request: ActorSaveRequest): Promise<ActorResult<ActorSaveResult>> =>
    callCore('actorSave', request),

  /** 删除演员（连带图集文件） */
  remove: (request: ActorRemoveRequest): Promise<ActorResult<null>> =>
    callCore('actorRemove', request),

  /** 导入本机图片 */
  importImages: (request: ActorImageImportRequest): Promise<ActorResult<ActorImageImportResult>> =>
    runJob('actor.importImages', request),

  /** 删除一张图片 */
  removeImage: (request: ActorImageRequest): Promise<ActorResult<null>> =>
    callCore('actorRemoveImage', request),

  /** 设为头像 */
  setAvatar: (request: ActorImageRequest): Promise<ActorResult<null>> =>
    callCore('actorSetAvatar', request),

  /** 抓取一位演员（可能超过 30s，走长任务通道） */
  scrape: (request: ActorScrapeRequest): Promise<ActorResult<ActorScrapeResult>> =>
    runJob('actor.scrape', request),

  /** 批量抓取资料不全的演员 */
  scrapeMissing: (): Promise<ActorResult<ActorScrapeMissingResult>> =>
    callCore('actorScrapeMissing'),

  /** 读补全队列的当前状态（挂载时拉一次快照，之后靠进度事件覆盖） */
  scrapeStatus: (): Promise<ActorResult<ActorScrapeStatus>> => callCore('actorScrapeStatus'),

  /** 订阅补全队列进度，返回取消订阅函数 */
  onScrapeProgress: (listener: (status: ActorScrapeStatus) => void): (() => void) =>
    subscribe(CORE_EVENTS.actorProgress, listener)
}

export type ActorApi = typeof actorApi
