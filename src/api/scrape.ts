/**
 * 刮削模块桥：所有调用返回 `ScrapeResult` 信封；单条手动匹配走长任务通道。
 */
import type { MediaBrowseEntry } from '@common/types/media'
import type {
  ScrapeBrowseRequest,
  ScrapeFileItem,
  ScrapeMatchRequest,
  ScrapeMatchResult,
  ScrapeProgressEvent,
  ScrapeResult,
  ScrapeStartRequest,
  ScrapeTaskSnapshot
} from '@common/types/scrape'
import type { TaskItem } from '@common/types/task'
import { CORE_EVENTS } from '@common/channels'
import { subscribe } from './events'
import { callCore } from './invoke'
import { runJob } from './job'

/** 任务快照 + 逐文件结果 */
export interface ScrapeTaskDetail {
  task: ScrapeTaskSnapshot
  files: ScrapeFileItem[]
}

export const scrapeApi = {
  /** 浏览资料库目录：子目录 + 影片（渲染层暂无入口，通道保留） */
  browse: (request: ScrapeBrowseRequest): Promise<ScrapeResult<MediaBrowseEntry[]>> =>
    callCore('scrapeBrowse', request),

  start: (request: ScrapeStartRequest): Promise<ScrapeResult<ScrapeTaskSnapshot>> =>
    callCore('scrapeStart', request),

  cancel: (taskId: string): Promise<ScrapeResult<ScrapeTaskSnapshot>> =>
    callCore('scrapeCancel', { taskId }),

  resume: (taskId: string): Promise<ScrapeResult<ScrapeTaskSnapshot>> =>
    callCore('scrapeResume', { taskId }),

  getTask: (taskId: string): Promise<ScrapeResult<ScrapeTaskDetail>> =>
    callCore('scrapeGetTask', { taskId }),

  listTasks: (limit?: number): Promise<ScrapeResult<TaskItem[]>> =>
    callCore('scrapeListTasks', { limit }),

  /** core 是否有任务在跑：任务不受窗口开关影响 */
  running: (): Promise<ScrapeResult<boolean>> => callCore('scrapeRunning'),

  /** 手动匹配：用选中的候选刮削单条，**等它跑完才返回**（长任务通道） */
  match: (request: ScrapeMatchRequest): Promise<ScrapeResult<ScrapeMatchResult>> =>
    runJob('scrape.match', request),

  /** 订阅任务进度，返回取消订阅函数 */
  onProgress: (listener: (event: ScrapeProgressEvent) => void): (() => void) =>
    subscribe(CORE_EVENTS.scrapeProgress, listener)
}

export type ScrapeApi = typeof scrapeApi
