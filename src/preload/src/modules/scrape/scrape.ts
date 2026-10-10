import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type { MediaBrowseEntry } from '@common/types/media'
import type {
  ScrapeBrowseRequest,
  ScrapeFileItem,
  ScrapeProgressEvent,
  ScrapeResult,
  ScrapeStartRequest,
  ScrapeTaskSnapshot
} from '@common/types/scrape'
import type { TaskItem } from '@common/types/task'
import { ScrapeChannels } from './scrapeChannels'

/** 任务快照 + 逐文件结果 */
export interface ScrapeTaskDetail {
  task: ScrapeTaskSnapshot
  files: ScrapeFileItem[]
}

/**
 * 刮削模块桥。
 *
 * 契约：所有 invoke 都返回 `ScrapeResult` 信封而**不抛异常**
 * （contextBridge 传递自定义错误的附加属性并不可靠，code 会丢失）。
 */
export const scrapeApi = {
  /** 浏览资料库目录：子目录 + 影片，供工作台勾选 */
  browse: (request: ScrapeBrowseRequest): Promise<ScrapeResult<MediaBrowseEntry[]>> =>
    ipcRenderer.invoke(ScrapeChannels.browse, request),

  start: (request: ScrapeStartRequest): Promise<ScrapeResult<ScrapeTaskSnapshot>> =>
    ipcRenderer.invoke(ScrapeChannels.start, request),

  cancel: (taskId: string): Promise<ScrapeResult<ScrapeTaskSnapshot>> =>
    ipcRenderer.invoke(ScrapeChannels.cancel, { taskId }),

  resume: (taskId: string): Promise<ScrapeResult<ScrapeTaskSnapshot>> =>
    ipcRenderer.invoke(ScrapeChannels.resume, { taskId }),

  getTask: (taskId: string): Promise<ScrapeResult<ScrapeTaskDetail>> =>
    ipcRenderer.invoke(ScrapeChannels.getTask, { taskId }),

  listTasks: (limit?: number): Promise<ScrapeResult<TaskItem[]>> =>
    ipcRenderer.invoke(ScrapeChannels.listTasks, { limit }),

  /** 主进程是否有任务在跑：任务不受窗口开关影响，因此状态从主进程读 */
  running: (): Promise<ScrapeResult<boolean>> => ipcRenderer.invoke(ScrapeChannels.running),

  /** 订阅任务进度，返回取消订阅函数 */
  onProgress: (listener: (event: ScrapeProgressEvent) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: ScrapeProgressEvent): void =>
      listener(payload)
    ipcRenderer.on(ScrapeChannels.progress, handler)
    return () => {
      ipcRenderer.removeListener(ScrapeChannels.progress, handler)
    }
  }
}

export type ScrapeApi = typeof scrapeApi
