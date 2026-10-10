/**
 * 刮削模块的 IPC 注册。
 *
 * 契约（沿用 plugin / file 域的写法）：
 * 1. 模块内部抛 `ScrapeError`，**只有 IPC 边界**把错误转成 `ScrapeResult` 信封；
 * 2. 入参一律按 unknown 从渲染层收窄，缺字段抛 `invalidArgument`；
 * 3. 任务在主进程运行，本文件只负责转发；进度通过 `scrape:progress` 单向推送。
 *
 * 刮削入口已经收敛到「资料库」这一侧：浏览走 `mediaWall.browseLibrary`，
 * 开始刮削走 `libraryScrape.startLibraryScrapeByIds`（刮削器与策略都来自资料库）。
 */
import { ipcMain } from 'electron'
import type { MediaBrowseEntry } from '@common/types/media'
import {
  ScrapeError,
  describeScrapeError,
  scrapeFail,
  scrapeOk,
  type ScrapeFileItem,
  type ScrapeResult,
  type ScrapeTaskSnapshot
} from '@common/types/scrape'
import { readNumber, readString, toSource } from '@common/types/setting/shared'
import type { TaskItem } from '@common/types/task'
import { startLibraryScrapeByIds } from '$/modules/library/libraryScrape'
import { browseLibrary } from '$/modules/media/mediaWall'
import { ScrapeChannels } from '~/modules/scrape/scrapeChannels'
import {
  cancelScrapeTask,
  getScrapeFileList,
  getScrapeTask,
  isScrapeRunning,
  listScrapeTasks,
  resumeScrapeTask
} from './scrapeRunner'

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

function readLibraryId(payload: unknown): string {
  const libraryId = readString(payloadOf(payload), 'libraryId', '').trim()
  if (libraryId.length === 0) throw new ScrapeError('invalidArgument', '缺少资料库 ID')
  return libraryId
}

/** 渲染层勾选的待刮削影片（媒体条目 ID） */
function readItemIds(payload: unknown): string[] {
  const raw = payloadOf(payload).itemIds
  if (!Array.isArray(raw)) throw new ScrapeError('invalidArgument', '缺少待刮削影片列表')
  return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function readTaskId(payload: unknown): string {
  const taskId = readString(payloadOf(payload), 'taskId', '').trim()
  if (taskId.length === 0) throw new ScrapeError('invalidArgument', '缺少任务 ID')
  return taskId
}

export function registerScrapeIpc(): void {
  /** 浏览资料库目录：目录 + 影片，供工作台勾选 */
  ipcMain.handle(ScrapeChannels.browse, (_event, payload: unknown) =>
    handle<MediaBrowseEntry[]>(() =>
      browseLibrary({
        libraryId: readLibraryId(payload),
        dirPath: readString(payloadOf(payload), 'dirPath', '')
      })
    )
  )

  ipcMain.handle(ScrapeChannels.start, (_event, payload: unknown) =>
    handle<ScrapeTaskSnapshot>(async () => {
      const result = await startLibraryScrapeByIds(readLibraryId(payload), readItemIds(payload))
      return getScrapeTask(result.taskId)
    })
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
