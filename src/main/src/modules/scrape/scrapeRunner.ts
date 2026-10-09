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
import {
  basenameRemotePath,
  dirnameRemotePath,
  normalizeRemotePath,
  scraperIdsOf
} from '@common/types/file'
import type { PluginSummary } from '@common/types/plugin'
import {
  ScrapeError,
  type ScrapeFileItem,
  type ScrapeScanEntry,
  type ScrapeStartRequest,
  type ScrapeTaskSnapshot
} from '@common/types/scrape'
import type { TaskItem, TaskStatus } from '@common/types/task'
import { listTask, getTask, insertTask, updateTask, interruptRunningTasks } from '$/db/repo/taskRepo'
import { insertScrapeFiles, listScrapeFile, updateScrapeFile } from '$/db/repo/scrapeRepo'
import { getFileClient } from '$/modules/file/fileClientManager'
import { getConnection } from '$/modules/file/fileConnectionStore'
import { listPluginSummaries } from '$/modules/plugin/pluginRegistry'
import { indexDirectory } from '$/modules/resource/resourceIndex'
import { loadSetting } from '$/modules/setting/settingStore'
import { broadcastScrapeProgress } from './scrapeEvents'
import {
  keywordOf,
  resolveOutputDir,
  runFileJob,
  type ScrapePluginRef,
  type ScrapeSettingsSnapshot
} from './scrapeFileJob'
import { createScrapeRunLog, type ScrapeRunLog } from './scrapeLogFile'
import { listRootVideos } from './scrapeVideo'

/** 运行中的任务：内存态只保存取消句柄与调度队列，真相以 sqlite 为准 */
interface RunningTask {
  taskId: string
  controller: AbortController
}

let running: RunningTask | null = null

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

/** 某个存储可用的刮削器；`configuredCount` 用于区分「一个没装」和「装了但没勾」 */
interface StoragePlugins {
  list: ScrapePluginRef[]
  configuredCount: number
}

/**
 * 可用插件：按插件页顺序，过滤停用与加载失败的。
 *
 * 存储配置了刮削器时只保留其中可用的那些，但**顺序仍按插件页**（不按勾选顺序），
 * 这样同一批文件在不同存储上的命中顺序只取决于插件页排序。
 */
function usablePlugins(connectionId: string): StoragePlugins {
  const all = listPluginSummaries()
    .filter((plugin: PluginSummary) => plugin.enabled && plugin.loadError.length === 0)
    .map((plugin) => ({ id: plugin.id, name: plugin.name }))
  const configured = scraperIdsOf(getConnection(connectionId))
  if (configured.length === 0) return { list: all, configuredCount: 0 }
  const wanted = new Set(configured)
  return { list: all.filter((plugin) => wanted.has(plugin.id)), configuredCount: configured.length }
}

/** 取可用插件；为空时按原因给出不同提示 */
function assertUsablePlugins(connectionId: string): ScrapePluginRef[] {
  const plugins = usablePlugins(connectionId)
  if (plugins.list.length > 0) return plugins.list
  throw plugins.configuredCount === 0
    ? new ScrapeError('pluginMissing', '没有可用的刮削插件，请先在插件页安装并启用插件')
    : new ScrapeError('pluginMissing', '该存储配置的刮削器均不可用，请在存储设置中重新选择')
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
      path: entry.path,
      name: entry.name,
      keyword: entry.keyword,
      status: duplicate ? 'skipped' : 'pending',
      pluginId: '',
      title: '',
      message: duplicate ? `与 ${entry.duplicateOf ?? ''} 同番号，已跳过` : '',
      coverId: '',
      coverPath: '',
      updatedAt: now
    }
  })
}

/** 校验待刮削路径必须直接位于根目录之下 */
function assertPaths(dirPath: string, paths: readonly string[]): void {
  const root = normalizeRemotePath(dirPath)
  for (const path of paths) {
    const normalized = normalizeRemotePath(path)
    if (dirnameRemotePath(normalized) !== root) {
      throw new ScrapeError('invalidArgument', `文件不在所选根目录下：${normalized}`)
    }
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
 */
async function runFiles(
  taskId: string,
  files: readonly ScrapeFileItem[],
  connectionId: string,
  dirPath: string,
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
          dirPath,
          entry: { path: item.path, name: item.name, keyword: item.keyword, num: keywordOf(item.name).num },
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
        outcome = { status: 'failed', pluginId: '', title: '', message }
      }

      finished += 1
      if (outcome.status === 'failed') failed += 1
      const done: ScrapeFileItem = {
        ...item,
        status: outcome.status,
        pluginId: outcome.pluginId,
        title: outcome.title,
        message: outcome.message,
        coverId: outcome.cover?.id ?? '',
        coverPath: outcome.cover?.path ?? '',
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

/** 任务终态后重建索引：文件可能被改名或移动，索引要跟着刷新（失败只记日志） */
async function rebuildIndexAfterTask(
  connectionId: string,
  dirPath: string,
  settings: ScrapeSettingsSnapshot,
  log: ScrapeRunLog
): Promise<void> {
  const dirs = [dirPath]
  if (settings.file.moveAfterSuccess) {
    const output = resolveOutputDir(settings.path.successOutputDir, dirPath)
    if (output !== dirPath) dirs.push(output)
  }
  for (const dir of dirs) {
    try {
      await indexDirectory(connectionId, dir)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      log.warn(`重建资源索引失败（${dir}）：${message}`)
    }
  }
}

/** 跑一个任务的全部待刮削文件（首次启动与「继续」共用） */
async function execute(
  task: ScrapeTaskSnapshot,
  connectionId: string,
  dirPath: string,
  pending: readonly ScrapeFileItem[]
): Promise<void> {
  const controller = new AbortController()
  running = { taskId: task.id, controller }
  const log = createScrapeRunLog(task.name)
  const plugins = assertUsablePlugins(connectionId)
  const settings = snapshotSettings()
  let hardFailure = false
  let client: Awaited<ReturnType<typeof getFileClient>>

  try {
    client = await getFileClient(connectionId)
    setTaskStatus(task.id, 'running', { message: `已开始，共 ${pending.length} 个文件` })
    log.info(
      `任务「${task.name}」开始，共 ${pending.length} 个文件，并发 ${settings.scrape.concurrency}`
    )
    await runFiles(
      task.id,
      pending,
      connectionId,
      dirPath,
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
  }

  await rebuildIndexAfterTask(connectionId, dirPath, settings, log)
  if (hardFailure) return

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

/**
 * 启动一个新任务。
 *
 * 扫描结果在这里一次性换成文件行落库，随后由运行器接管；函数本身**不等待**刮削完成，
 * 立即返回任务快照（渲染层靠进度事件与快照刷新）。
 */
export async function startScrapeTask(request: ScrapeStartRequest): Promise<ScrapeTaskSnapshot> {
  if (running) throw new ScrapeError('busy')
  const connectionId = request.connectionId.trim()
  const dirPath = normalizeRemotePath(request.dirPath)
  if (connectionId.length === 0) throw new ScrapeError('invalidArgument', '缺少数据源')
  if (request.paths.length === 0) throw new ScrapeError('invalidArgument', '请至少选择一个文件')
  assertPaths(dirPath, request.paths)

  // 先确认这个存储有可用刮削器，避免白扫一遍目录
  assertUsablePlugins(connectionId)

  const scanned = await listRootVideos({ connectionId, dirPath })
  const wanted = new Set(request.paths.map((path) => normalizeRemotePath(path)))
  const entries = scanned.filter((entry) => wanted.has(normalizeRemotePath(entry.path)))
  if (entries.length === 0) throw new ScrapeError('notFound', '所选文件已不在根目录下')

  const taskId = randomUUID()
  const now = Date.now()
  const task: ScrapeTaskSnapshot = {
    id: taskId,
    name: basenameRemotePath(dirPath) || '根目录',
    status: 'pending',
    connectionId,
    dirPath,
    total: entries.length,
    finished: 0,
    failed: 0,
    message: '',
    createdAt: now,
    updatedAt: now
  }
  const rows = rowsFromScan(taskId, entries)
  insertTask(task)
  insertScrapeFiles(rows)

  const pending = rows.filter((row) => row.status === 'pending')
  const snapshot = getScrapeTask(taskId)
  if (pending.length === 0) {
    setTaskStatus(taskId, 'success', { message: '所选文件均被判定为重复，无需刮削' })
    return getScrapeTask(taskId)
  }
  void execute(snapshot, connectionId, dirPath, pending)
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

/** 继续被取消或中断的任务：把未完成的行重新排队 */
export function resumeScrapeTask(taskId: string): ScrapeTaskSnapshot {
  if (running) throw new ScrapeError('busy')
  const task = getScrapeTask(taskId)
  if (task.status === 'running') throw new ScrapeError('busy', '任务正在运行')
  const pending = listScrapeFile(taskId).filter(
    (item) => item.status === 'pending' || item.status === 'running'
  )
  if (pending.length === 0) throw new ScrapeError('invalidArgument', '没有待刮削的文件')
  assertUsablePlugins(task.connectionId)
  const now = Date.now()
  pending.forEach((item) => updateScrapeFile(item.id, { status: 'pending', updatedAt: now }))
  const snapshot = setTaskStatus(taskId, 'running', { message: `继续处理 ${pending.length} 个文件` })
  void execute(snapshot, task.connectionId, task.dirPath, pending)
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
