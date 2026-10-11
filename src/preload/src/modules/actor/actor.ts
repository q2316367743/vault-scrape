import { ipcRenderer } from 'electron'
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
  ActorScrapeResult
} from '@common/types/actor'
import { ActorChannels } from './actorChannels'

/**
 * 演员模块桥。
 *
 * 契约：所有 invoke 都返回 `ActorResult` 信封而**不抛异常**
 * （contextBridge 传递自定义错误的附加属性并不可靠，code 会丢失）。
 */
export const actorApi = {
  /** 演员列表：关键词 / 标签筛选 + 排序 + 分页 */
  list: (request: ActorListRequest): Promise<ActorResult<ActorListResult>> =>
    ipcRenderer.invoke(ActorChannels.list, request),

  /** 演员详情：资料 + 该演员全部出演作品 */
  detail: (request: ActorDetailRequest): Promise<ActorResult<ActorDetailResult>> =>
    ipcRenderer.invoke(ActorChannels.detail, request),

  /** 新增（`actorId` 空）或更新演员 */
  save: (request: ActorSaveRequest): Promise<ActorResult<ActorSaveResult>> =>
    ipcRenderer.invoke(ActorChannels.save, request),

  /** 删除演员（连带图集文件） */
  remove: (request: ActorRemoveRequest): Promise<ActorResult<null>> =>
    ipcRenderer.invoke(ActorChannels.remove, request),

  /** 导入本机图片 */
  importImages: (request: ActorImageImportRequest): Promise<ActorResult<ActorImageImportResult>> =>
    ipcRenderer.invoke(ActorChannels.importImages, request),

  /** 删除一张图片 */
  removeImage: (request: ActorImageRequest): Promise<ActorResult<null>> =>
    ipcRenderer.invoke(ActorChannels.removeImage, request),

  /** 设为头像 */
  setAvatar: (request: ActorImageRequest): Promise<ActorResult<null>> =>
    ipcRenderer.invoke(ActorChannels.setAvatar, request),

  /** 抓取一位演员 */
  scrape: (request: ActorScrapeRequest): Promise<ActorResult<ActorScrapeResult>> =>
    ipcRenderer.invoke(ActorChannels.scrape, request),

  /** 批量抓取资料不全的演员 */
  scrapeMissing: (): Promise<ActorResult<ActorScrapeMissingResult>> =>
    ipcRenderer.invoke(ActorChannels.scrapeMissing)
}

export type ActorApi = typeof actorApi
