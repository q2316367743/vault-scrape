/**
 * 刮削域的 core API。
 *
 * 契约：
 * 1. 模块内部抛 `ScrapeError`，**只有 API 边界**把错误转成 `ScrapeResult` 信封；
 * 2. 入参一律按 unknown 收窄，缺字段抛 `invalidArgument`；
 * 3. 批量任务在 core 运行，进度通过 `scrape:progress` 推送；手动匹配是前台交互，
 *    等单条跑完才返回（可能超过 30s，渲染层用长任务通道调它）。
 */
import type { MediaBrowseEntry } from '@common/types/media'
import {
  ScrapeError,
  describeScrapeError,
  scrapeFail,
  scrapeOk,
  type ScrapeFileItem,
  type ScrapeMatchResult,
  type ScrapeResult,
  type ScrapeTaskSnapshot
} from '@common/types/scrape'
import { readNumber, readString, toSource } from '@common/types/setting/shared'
import type { TaskItem } from '@common/types/task'
import { startLibraryScrapeByIds } from '$/modules/library/libraryScrapeDispatch'
import { browseLibrary } from '$/modules/media/mediaBrowse'
import { matchItemManually } from './scrapeManualMatch'
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

/** 手动匹配：条目 ID + 选中的刮削器 + 选中的候选 ID */
function readMatchRequest(payload: unknown): {
  itemId: string
  pluginId: string
  movieId: string
} {
  const source = payloadOf(payload)
  const itemId = readString(source, 'itemId', '').trim()
  const pluginId = readString(source, 'pluginId', '').trim()
  const movieId = readString(source, 'movieId', '').trim()
  if (itemId.length === 0) throw new ScrapeError('invalidArgument', '缺少媒体条目 ID')
  if (pluginId.length === 0) throw new ScrapeError('invalidArgument', '缺少刮削器 ID')
  if (movieId.length === 0) throw new ScrapeError('invalidArgument', '缺少候选 ID')
  return { itemId, pluginId, movieId }
}

export const scrapeApi = {
  /** 浏览资料库目录：目录 + 影片（渲染层暂无入口，通道保留） */
  scrapeBrowse: (_ctx: unknown, payload: unknown): Promise<ScrapeResult<MediaBrowseEntry[]>> =>
    handle<MediaBrowseEntry[]>(() =>
      browseLibrary({
        libraryId: readLibraryId(payload),
        dirPath: readString(payloadOf(payload), 'dirPath', '')
      })
    ),

  scrapeStart: (_ctx: unknown, payload: unknown): Promise<ScrapeResult<ScrapeTaskSnapshot>> =>
    handle<ScrapeTaskSnapshot>(async () => {
      const result = await startLibraryScrapeByIds(readLibraryId(payload), readItemIds(payload))
      return getScrapeTask(result.taskId)
    }),

  scrapeCancel: (_ctx: unknown, payload: unknown): Promise<ScrapeResult<ScrapeTaskSnapshot>> =>
    handle<ScrapeTaskSnapshot>(() => cancelScrapeTask(readTaskId(payload))),

  scrapeResume: (_ctx: unknown, payload: unknown): Promise<ScrapeResult<ScrapeTaskSnapshot>> =>
    handle<ScrapeTaskSnapshot>(() => resumeScrapeTask(readTaskId(payload))),

  scrapeGetTask: (_ctx: unknown, payload: unknown): Promise<ScrapeResult<ScrapeTaskDetail>> =>
    handle<ScrapeTaskDetail>(() => {
      const taskId = readTaskId(payload)
      return { task: getScrapeTask(taskId), files: getScrapeFileList(taskId) }
    }),

  scrapeListTasks: (_ctx: unknown, payload: unknown): Promise<ScrapeResult<TaskItem[]>> =>
    handle<TaskItem[]>(() => {
      const limit = readNumber(payloadOf(payload), 'limit', 20)
      return listScrapeTasks(limit)
    }),

  /** 渲染层挂载后用它判断按钮状态：任务在 core 跑，窗口重开也不会误判为空闲 */
  scrapeRunning: (): Promise<ScrapeResult<boolean>> => handle<boolean>(() => isScrapeRunning()),

  /** 手动匹配：只刮这一条，跑完才回包（与批量任务共用运行槽位，忙时返回 `busy`） */
  scrapeMatch: (_ctx: unknown, payload: unknown): Promise<ScrapeResult<ScrapeMatchResult>> =>
    handle<ScrapeMatchResult>(() => matchItemManually(readMatchRequest(payload)))
}
