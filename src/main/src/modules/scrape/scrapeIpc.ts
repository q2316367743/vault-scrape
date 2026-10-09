/**
 * 刮削模块的 IPC 注册。
 *
 * 契约（沿用 plugin / file 域的写法）：
 * 1. 模块内部抛 `ScrapeError`，**只有 IPC 边界**把错误转成 `ScrapeResult` 信封；
 * 2. 入参一律按 unknown 从渲染层收窄，缺字段抛 `invalidArgument`；
 * 3. 任务在主进程运行，本文件只负责转发；进度通过 `scrape:progress` 单向推送。
 */
import { ipcMain } from 'electron'
import { readNumber, readString, toSource } from '@common/types/setting/shared'
import {
  ScrapeError,
  describeScrapeError,
  scrapeFail,
  scrapeOk,
  type ScrapeFileItem,
  type ScrapeResult,
  type ScrapeScanEntry,
  type ScrapeStartRequest,
  type ScrapeTaskSnapshot
} from '@common/types/scrape'
import type { TaskItem } from '@common/types/task'
import { ScrapeChannels } from '~/modules/scrape/scrapeChannels'
import {
  cancelScrapeTask,
  getScrapeFileList,
  getScrapeTask,
  isScrapeRunning,
  listScrapeTasks,
  resumeScrapeTask,
  startScrapeTask
} from './scrapeRunner'
import { listRootVideos } from './scrapeVideo'

/** 任务快照 + 逐文件结果：渲染层一次拉全，之后靠进度事件增量更新 */
export interface ScrapeTaskDetail {
  task: ScrapeTaskSnapshot
  files: ScrapeFileItem[]
}

function handle<T>(task: () => Promise<T> | T): Promise<ScrapeResult<T>> {
  return Promise.resolve()
    .then(task)
    .then((data) => scrapeOk(data))
    .catch((error: unknown) => {
      const { code, message } = describeScrapeError(error)
      return scrapeFail(code, message)
    })
}

function payloadOf(payload: unknown): Record<string, unknown> {
  return toSource(payload) ?? {}
}

function readConnectionId(payload: unknown): string {
  const connectionId = readString(payloadOf(payload), 'connectionId', '').trim()
  if (connectionId.length === 0) throw new ScrapeError('invalidArgument', '缺少数据源')
  return connectionId
}

function readDirPath(payload: unknown): string {
  return readString(payloadOf(payload), 'dirPath', '')
}

function readTaskId(payload: unknown): string {
  const taskId = readString(payloadOf(payload), 'taskId', '').trim()
  if (taskId.length === 0) throw new ScrapeError('invalidArgument', '缺少任务 ID')
  return taskId
}

/** 渲染层提交的待刮削路径：只保留非空字符串，去重交给运行器 */
function readPaths(payload: unknown): string[] {
  const raw = payloadOf(payload).paths
  if (!Array.isArray(raw)) throw new ScrapeError('invalidArgument', '缺少待刮削文件列表')
  return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function readStartRequest(payload: unknown): ScrapeStartRequest {
  return {
    connectionId: readConnectionId(payload),
    dirPath: readDirPath(payload),
    paths: readPaths(payload)
  }
}

export function registerScrapeIpc(): void {
  ipcMain.handle(ScrapeChannels.listVideos, (_event, payload: unknown) =>
    handle<ScrapeScanEntry[]>(() =>
      listRootVideos({ connectionId: readConnectionId(payload), dirPath: readDirPath(payload) })
    )
  )

  ipcMain.handle(ScrapeChannels.start, (_event, payload: unknown) =>
    handle<ScrapeTaskSnapshot>(() => startScrapeTask(readStartRequest(payload)))
  )

  ipcMain.handle(ScrapeChannels.cancel, (_event, payload: unknown) =>
    handle<ScrapeTaskSnapshot>(() => cancelScrapeTask(readTaskId(payload)))
  )

  ipcMain.handle(ScrapeChannels.resume, (_event, payload: unknown) =>
    handle<ScrapeTaskSnapshot>(() => resumeScrapeTask(readTaskId(payload)))
  )

  ipcMain.handle(ScrapeChannels.getTask, (_event, payload: unknown) =>
    handle<ScrapeTaskDetail>(() => {
      const taskId = readTaskId(payload)
      return { task: getScrapeTask(taskId), files: getScrapeFileList(taskId) }
    })
  )

  ipcMain.handle(ScrapeChannels.listTasks, (_event, payload: unknown) =>
    handle<TaskItem[]>(() => {
      const limit = readNumber(payloadOf(payload), 'limit', 20)
      return listScrapeTasks(limit)
    })
  )

  /** 渲染层挂载后用它判断按钮状态：任务在主进程跑，窗口重开也不会误判为空闲 */
  ipcMain.handle(ScrapeChannels.running, () => handle<boolean>(() => isScrapeRunning()))
}
