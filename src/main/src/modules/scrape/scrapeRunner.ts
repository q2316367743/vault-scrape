/**
 * 刮削任务运行器（主进程单例）。
 *
 * 契约（对应需求里的运行方式）：
 * 1. **同时在跑的任务只有一个**：第二次「开始」直接返回 `busy`，避免同一批文件被两个任务改来改去；
 * 2. 并发度来自 `scrape.concurrency`，每处理 `scrape.restAfterCount` 个文件休息 `scrape.restDuration` 秒；
 * 3. 任务与逐文件结果**始终先落库再推送**，渲染层关闭或切走再回来时拉快照即可复原进度；
 * 4. 取消（`cancel`）把任务置为 `paused`，未处理的文件仍是 `pending`，可以「继续」；
 * 5. 应用重启时残留的 `running` 任务由 `markInterruptedOnStartup()` 标记为 `interrupted`；
 * 6. 单文件失败只累计 `failed` 并写结果行，**不中断**其余文件。
 */
import { randomUUID } from 'crypto'
import { basenameRemotePath, dirnameRemotePath, normalizeRemotePath } from '@common/types/file'
import type { MediaLibrary } from '@common/types/library'
import type { PluginSummary } from '@common/types/plugin'
import {
  ScrapeError,
  type ScrapeFileItem,
  type ScrapeScanEntry,
  type ScrapeTaskSnapshot
} from '@common/types/scrape'
import type { TaskItem, TaskStatus } from '@common/types/task'
import { findLibraryByPath, getLibrary, patchLibrary } from '$/db/repo/libraryRepo'
import { listTask, getTask, insertTask, updateTask, interruptRunningTasks } from '$/db/repo/taskRepo'
import { insertScrapeFiles, listScrapeFile, updateScrapeFile } from '$/db/repo/scrapeRepo'
import { getFileClient } from '$/modules/file/fileClientManager'
import { listPluginSummaries } from '$/modules/plugin/pluginRegistry'
import { loadSetting } from '$/modules/setting/settingStore'
import { broadcastScrapeProgress } from './scrapeEvents'
import {
  keywordOf,
  runFileJob,
  type ScrapeLibraryPolicy,
  type ScrapePluginRef,
  type ScrapeSettingsSnapshot
} from './scrapeFileJob'
import { createScrapeRunLog } from './scrapeLogFile'

/** 运行中的任务：内存态只保存取消句柄与调度队列，真相以 sqlite 为准 */
interface RunningTask {
  taskId: string
  controller: AbortController
}

let running: RunningTask | null = null

/**
 * 任务的刮削器与资料库绑定（内存态）。
 *
 * 「继续」要沿用启动时那一套刮削器与资料库策略；应用重启后这两张表会清空，
 * 此时按 `(connectionId, dirPath)` 反查拥有该路径的资料库来回落（任务表没有 library_id 列）。
 */
const taskScrapers = new Map<string, readonly string[]>()
const taskLibraries = new Map<string, string>()

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) {
      resolve()
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** 某个资料库可用的刮削器；`configuredCount` 用于区分「一个没装」和「装了但没勾」 */
interface LibraryPlugins {
  list: ScrapePluginRef[]
  configuredCount: number
}

/**
 * 可用插件：按插件页顺序，过滤停用与加载失败的。
 *
 * 只认资料库绑定的刮削器（**不再回落到存储配置**）；空清单是合法状态
 * （该库不刮削），此时直接返回空数组，由调用方按「未配置刮削器」处理。
 * 无论勾选顺序如何，命中顺序只看插件页排序。
 */
function usablePlugins(scraperIds: readonly string[]): LibraryPlugins {
  const all = listPluginSummaries()
    .filter((plugin: PluginSummary) => plugin.enabled && plugin.loadError.length === 0)
    .map((plugin) => ({ id: plugin.id, name: plugin.name }))
  const configured = [...new Set(scraperIds.filter((id) => id.length > 0))]
  if (configured.length === 0) return { list: [], configuredCount: 0 }
  const wanted = new Set(configured)
  return { list: all.filter((plugin) => wanted.has(plugin.id)), configuredCount: configured.length }
}

/** 取可用插件；为空时按原因给出不同提示 */
function assertUsablePlugins(scraperIds: readonly string[]): ScrapePluginRef[] {
  const plugins = usablePlugins(scraperIds)
  if (plugins.list.length > 0) return plugins.list
  throw plugins.configuredCount === 0
    ? new ScrapeError('pluginMissing', '该资料库未配置刮削器（空刮削器表示不刮削），请先在资料库设置里选择')
    : new ScrapeError('pluginMissing', '资料库配置的刮削器均不可用，请重新选择')
}

function snapshotSettings(): ScrapeSettingsSnapshot {
  const setting = loadSetting()
  return {
    scrape: setting.scrape,
    download: setting.download,
    naming: setting.naming,
    file: setting.file,
    path: setting.path
  }
}

/** 任务要沿用的资料库策略：改名 / 移动 / 写 NFO / 图片落盘位置全部来自资料库 */
function libraryPolicy(library: MediaLibrary): ScrapeLibraryPolicy {
  return {
    libraryId: library.id,
    imageSaveMode: library.imageSaveMode,
    writeNfo: library.writeNfo,
    renameEnabled: library.renameEnabled,
    moveEnabled: library.moveEnabled,
    moveDirectory: library.moveDirectory
  }
}

/** 任务快照读库后原样返回；任务不存在时抛 `notFound` */
export function getScrapeTask(taskId: string): ScrapeTaskSnapshot {
  const task = getTask(taskId)
  if (!task) throw new ScrapeError('notFound', `刮削任务不存在：${taskId}`)
  return task
}

/** 任务快照 + 逐文件结果 */
export function getScrapeFileList(taskId: string): ScrapeFileItem[] {
  getScrapeTask(taskId)
  return listScrapeFile(taskId)
}

/** 最近的任务列表（复用公共 task 查询） */
export function listScrapeTasks(limit = 20): TaskItem[] {
  return listTask({ limit })
}

function rowsFromScan(taskId: string, entries: readonly ScrapeScanEntry[]): ScrapeFileItem[] {
  const now = Date.now()
  return entries.map((entry): ScrapeFileItem => {
    const duplicate = entry.duplicateOf !== undefined && entry.duplicateOf.length > 0
    return {
      id: `${taskId}:${entry.path}`,
      taskId,
      itemId: entry.itemId,
      path: entry.path,
      finalPath: entry.path,
      name: entry.name,
      keyword: entry.keyword,
      status: duplicate ? 'skipped' : 'pending',
      pluginId: '',
      title: '',
      message: duplicate ? `与 ${entry.duplicateOf ?? ''} 同番号，已跳过` : '',
      updatedAt: now
    }
  })
}

/**
 * 校验待刮削路径必须落在所选根目录的**子树**里。
 *
 * 工作台只勾选根目录下一层的文件；资料库的任务文件散布在多层子目录里，
 * 因此这里按前缀判断而不是「父目录必须等于根目录」。
 */
function assertInside(dirPath: string, paths: readonly string[]): void {
  const root = normalizeRemotePath(dirPath)
  for (const path of paths) {
    const normalized = normalizeRemotePath(path)
    if (root === '/' || normalized === root || normalized.startsWith(`${root}/`)) continue
    throw new ScrapeError('invalidArgument', `文件不在所选根目录下：${normalized}`)
  }
}

/** 更新任务行并把最新快照推给渲染层 */
function pushFile(taskId: string, item: ScrapeFileItem): void {
  updateScrapeFile(item.id, item)
  broadcastScrapeProgress({ task: getScrapeTask(taskId), file: item })
}

function setTaskStatus(taskId: string, status: TaskStatus, patch: Partial<TaskItem> = {}): ScrapeTaskSnapshot {
  updateTask(taskId, { status, updatedAt: Date.now(), ...patch })
  return getScrapeTask(taskId)
}

/**
 * 并发跑完给定的文件行。
 *
 * 队列用游标推进：worker 数固定为并发度，每个 worker 处理完一个文件就取下一条，
 * 从而做到「并发度恒定、不预先给每人分活」。
 *
 * 每个文件都按**它自己所在的目录**处理：产出、改名、失败箱都落在文件旁边，
 * 所以同一个任务可以同时覆盖一棵多层子树（资料库）或一个目录（工作台）。
 */
async function runFiles(
  taskId: string,
  files: readonly ScrapeFileItem[],
  connectionId: string,
  policy: ScrapeLibraryPolicy,
  plugins: readonly ScrapePluginRef[],
  settings: ScrapeSettingsSnapshot,
  client: Awaited<ReturnType<typeof getFileClient>>,
  signal: AbortSignal,
  log: ReturnType<typeof createScrapeRunLog>
): Promise<void> {
  const total = files.length
  let cursor = 0
  let finished = 0
  let failed = 0
  let sinceRest = 0

  const worker = async (): Promise<void> => {
    while (!signal.aborted) {
      const index = cursor
      cursor += 1
      const item = files[index]
      if (!item) return

      const running: ScrapeFileItem = { ...item, status: 'running', updatedAt: Date.now() }
      pushFile(taskId, running)

      let outcome: Awaited<ReturnType<typeof runFileJob>>
      try {
        outcome = await runFileJob({
          taskId,
          connectionId,
          policy,
          dirPath: dirnameRemotePath(item.path),
          entry: {
            itemId: item.itemId,
            path: item.path,
            name: item.name,
            keyword: item.keyword,
            num: keywordOf(item.name).num
          },
          plugins,
          settings,
          client,
          signal,
          log
        })
      } catch (error) {
        if (signal.aborted) {
          // 取消：把这一行退回待刮削，任务可以继续
          pushFile(taskId, { ...item, status: 'pending', message: '任务已取消', updatedAt: Date.now() })
          return
        }
        const message = error instanceof Error ? error.message : '未知错误'
        outcome = { status: 'failed', pluginId: '', title: '', message, finalPath: item.path }
      }

      finished += 1
      if (outcome.status === 'failed') failed += 1
      const done: ScrapeFileItem = {
        ...item,
        status: outcome.status,
        pluginId: outcome.pluginId,
        title: outcome.title,
        message: outcome.message,
        finalPath: outcome.finalPath,
        updatedAt: Date.now()
      }
      updateScrapeFile(done.id, done)
      setTaskStatus(taskId, 'running', { finished, failed })
      broadcastScrapeProgress({ task: getScrapeTask(taskId), file: done })

      sinceRest += 1
      if (settings.scrape.restAfterCount > 0 && sinceRest >= settings.scrape.restAfterCount) {
        sinceRest = 0
        log.info(`已处理 ${finished}/${total} 个文件，休息 ${settings.scrape.restDuration} 秒`)
        await sleep(settings.scrape.restDuration * 1000, signal)
      }
    }
  }

  const concurrency = Math.max(1, Math.floor(settings.scrape.concurrency))
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
}

/** 跑一个任务的全部待刮削文件（首次启动与「继续」共用） */
async function execute(
  task: ScrapeTaskSnapshot,
  library: MediaLibrary,
  pending: readonly ScrapeFileItem[],
  scraperIds: readonly string[]
): Promise<void> {
  const controller = new AbortController()
  running = { taskId: task.id, controller }
  const log = createScrapeRunLog(task.name)
  const plugins = assertUsablePlugins(scraperIds)
  const policy = libraryPolicy(library)
  const settings = snapshotSettings()
  let hardFailure = false
  let client: Awaited<ReturnType<typeof getFileClient>>

  try {
    client = await getFileClient(task.connectionId)
    setTaskStatus(task.id, 'running', { message: `已开始，共 ${pending.length} 个文件` })
    log.info(
      `任务「${task.name}」开始，共 ${pending.length} 个文件，并发 ${settings.scrape.concurrency}`
    )
    await runFiles(
      task.id,
      pending,
      task.connectionId,
      policy,
      plugins,
      settings,
      client,
      controller.signal,
      log
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    log.error(`任务异常终止：${message}`)
    setTaskStatus(task.id, 'failed', { message })
    hardFailure = true
  } finally {
    running = null
    taskScrapers.delete(task.id)
    taskLibraries.delete(task.id)
  }

  if (hardFailure) return

  // 文件若被改名 / 移动，逐文件刮削已就地更新媒体源；这里只刷新资料库的最近刮削时间
  patchLibrary(library.id, { lastScrapeAt: Date.now() })

  if (controller.signal.aborted) {
    const remain = listScrapeFile(task.id).filter((item) => item.status === 'pending').length
    setTaskStatus(task.id, 'paused', { message: `已取消，剩余 ${remain} 个文件` })
    log.warn(`任务「${task.name}」已取消，剩余 ${remain} 个文件`)
    return
  }

  const finalFiles = listScrapeFile(task.id)
  const failed = finalFiles.filter((item) => item.status === 'failed').length
  const success = finalFiles.filter((item) => item.status === 'success').length
  const skipped = finalFiles.filter((item) => item.status === 'skipped').length
  const message = `完成 ${success} 个，失败 ${failed} 个，跳过 ${skipped} 个`
  setTaskStatus(task.id, failed > 0 ? 'failed' : 'success', { message })
  log.info(`任务「${task.name}」结束：${message}`)
}

/** 用一批已经解析好的扫描条目建任务（资料库扫描之后就走这条路径） */
export interface ScrapeEntriesRequest {
  connectionId: string
  /** 所属资料库：决定刮削器，以及改名 / 移动 / 写 NFO / 图片落盘位置 */
  libraryId: string
  /** 任务展示用的根目录（连接内路径）；资料库传归属目录，可能是 `/` */
  dirPath: string
  taskName: string
  entries: readonly ScrapeScanEntry[]
  /** 资料库绑定的刮削器（必填，不再回落到存储配置） */
  scraperIds: readonly string[]
}

/**
 * 用一批扫描条目建任务并立即启动调度。
 *
 * 调用前请自行保证 `entries` 非空且都落在 `dirPath` 子树内；本函数只负责落库与调度。
 * 与其它入口一样**不等待**刮削完成，立即返回任务快照。
 */
export function startScrapeTaskForEntries(request: ScrapeEntriesRequest): ScrapeTaskSnapshot {
  if (running) throw new ScrapeError('busy')
  const connectionId = request.connectionId.trim()
  const libraryId = request.libraryId.trim()
  const dirPath = normalizeRemotePath(request.dirPath)
  if (connectionId.length === 0) throw new ScrapeError('invalidArgument', '缺少数据源')
  if (libraryId.length === 0) throw new ScrapeError('invalidArgument', '缺少资料库 ID')
  if (request.entries.length === 0) throw new ScrapeError('invalidArgument', '请至少选择一个文件')
  const library = getLibrary(libraryId)
  if (!library) throw new ScrapeError('notFound', `资料库不存在：${libraryId}`)
  assertInside(
    dirPath,
    request.entries.map((entry) => entry.path)
  )
  // 先确认有可用刮削器，避免白建一个任务
  assertUsablePlugins(request.scraperIds)

  const taskId = randomUUID()
  const now = Date.now()
  const task: ScrapeTaskSnapshot = {
    id: taskId,
    name: request.taskName.trim().length > 0 ? request.taskName.trim() : basenameRemotePath(dirPath) || '根目录',
    status: 'pending',
    connectionId,
    dirPath,
    total: request.entries.length,
    finished: 0,
    failed: 0,
    message: '',
    createdAt: now,
    updatedAt: now
  }
  const rows = rowsFromScan(taskId, request.entries)
  insertTask(task)
  insertScrapeFiles(rows)
  taskScrapers.set(taskId, [...request.scraperIds])
  taskLibraries.set(taskId, library.id)

  const pending = rows.filter((row) => row.status === 'pending')
  if (pending.length === 0) {
    setTaskStatus(taskId, 'success', { message: '所选文件均被判定为重复，无需刮削' })
    return getScrapeTask(taskId)
  }
  void execute(getScrapeTask(taskId), library, pending, request.scraperIds)
  return getScrapeTask(taskId)
}

/** 取消正在运行的任务；未开始的窗口期当作「已经在跑」 */
export function cancelScrapeTask(taskId: string): ScrapeTaskSnapshot {
  const task = getScrapeTask(taskId)
  if (task.status !== 'running') throw new ScrapeError('invalidArgument', '任务当前不在运行')
  if (!running || running.taskId !== taskId) {
    return setTaskStatus(taskId, 'paused', { message: '任务已取消' })
  }
  running.controller.abort()
  return setTaskStatus(taskId, 'paused', { message: '正在取消…' })
}

/**
 * 继续被取消或中断的任务：把未完成的行重新排队。
 *
 * 应用重启后内存绑定已丢，用 `(connectionId, dirPath)` 反查拥有该路径的资料库，
 * 拿它的刮削器与策略继续——与首次启动完全同一条路径。
 */
export function resumeScrapeTask(taskId: string): ScrapeTaskSnapshot {
  if (running) throw new ScrapeError('busy')
  const task = getScrapeTask(taskId)
  if (task.status === 'running') throw new ScrapeError('busy', '任务正在运行')
  const pending = listScrapeFile(taskId).filter(
    (item) => item.status === 'pending' || item.status === 'running'
  )
  if (pending.length === 0) throw new ScrapeError('invalidArgument', '没有待刮削的文件')

  const fallback = findLibraryByPath(task.connectionId, task.dirPath)
  const libraryId = taskLibraries.get(taskId) ?? fallback?.id ?? ''
  const library = libraryId.length > 0 ? getLibrary(libraryId) : null
  if (!library) throw new ScrapeError('pluginMissing', '找不到任务所属的资料库，请重新选择刮削器')
  const scraperIds = taskScrapers.get(taskId) ?? library.scrapers
  assertUsablePlugins(scraperIds)

  taskScrapers.set(taskId, [...scraperIds])
  taskLibraries.set(taskId, library.id)
  const now = Date.now()
  pending.forEach((item) => updateScrapeFile(item.id, { status: 'pending', updatedAt: now }))
  const snapshot = setTaskStatus(taskId, 'running', { message: `继续处理 ${pending.length} 个文件` })
  void execute(snapshot, library, pending, scraperIds)
  return snapshot
}

/** 应用启动时把上次残留的 running 任务标记为中断，返回处理条数 */
export function markInterruptedOnStartup(): number {
  return interruptRunningTasks(Date.now())
}

/** 当前是否有任务在跑（渲染层可据此禁用「开始」） */
export function isScrapeRunning(): boolean {
  return running !== null
}
