/**
 * 工作台刮削的渲染层状态机。
 *
 * 契约：
 * - 任务进度以主进程 / sqlite 为准（`scrape:getTask` + `scrape:progress`），
 *   本 composable 只缓存快照，因此切换 tab、关闭窗口再回来都不会丢进度；
 * - 扫描结果（未开始任务时）与任务结果（进行中/结束后）合并成同一张表，
 *   按路径对齐，扫描行状态为 `idle`；
 * - 同番号重复文件由主进程标记 `duplicateOf`，渲染层默认不勾选且禁止勾选。
 */
import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { FILE_ROOT, basenameRemotePath, type FileConnection } from '@common/types/file'
import { buildResourceUrl } from '@common/types/resource'
import {
  isScrapeOk,
  type ScrapeFileItem,
  type ScrapeProgressEvent,
  type ScrapeScanEntry,
  type ScrapeTaskSnapshot
} from '@common/types/scrape'
import { scrapeApi } from '@/api'
import type { WorkspaceRowStatus } from '../workspaceUtils'

/** 表格行：扫描行与任务结果行合并后的形状 */
export interface WorkspaceRow {
  path: string
  name: string
  keyword: string
  num: string
  size: number
  duplicateOf: string
  status: WorkspaceRowStatus
  pluginId: string
  title: string
  message: string
  /** 刮削产出的封面地址（storage:// 私有协议）；没有封面时为空串 */
  coverUrl: string
}

/**
 * 封面地址：storage://存储ID/资源ID/文件名。
 *
 * 文件名只用于让地址可读，协议按资源 ID 定位，因此移动/改名后依然有效。
 */
function coverUrlOf(connectionId: string, coverId: string, coverPath: string): string {
  if (connectionId.length === 0 || coverId.length === 0 || coverPath.length === 0) return ''
  return buildResourceUrl(connectionId, coverId, basenameRemotePath(coverPath))
}

/** 工作台刮削状态机 */
export function useWorkspaceScrape(connection: Ref<FileConnection | null>) {
  const dirPath = ref<string>(FILE_ROOT)
  const entries = ref<ScrapeScanEntry[]>([])
  const files = ref<ScrapeFileItem[]>([])
  const task = ref<ScrapeTaskSnapshot | null>(null)
  const selected = ref<string[]>([])
  const scanning = ref(false)
  const submitting = ref(false)
  const running = ref(false)

  let disposeProgress: (() => void) | null = null

  const rows = computed<WorkspaceRow[]>(() => {
    const connectionId = connection.value?.id ?? ''
    const scanned = new Map(entries.value.map((entry) => [entry.path, entry]))
    const recorded = new Map(files.value.map((file) => [file.path, file]))
    const merged: WorkspaceRow[] = []

    for (const file of files.value) {
      const entry = scanned.get(file.path)
      merged.push({
        path: file.path,
        name: file.name,
        keyword: file.keyword || entry?.keyword || '',
        num: entry?.num ?? '',
        size: entry?.size ?? 0,
        duplicateOf: entry?.duplicateOf ?? '',
        status: file.status,
        pluginId: file.pluginId,
        title: file.title,
        message: file.message,
        coverUrl: coverUrlOf(connectionId, file.coverId, file.coverPath)
      })
    }

    for (const entry of entries.value) {
      if (recorded.has(entry.path)) continue
      merged.push({
        path: entry.path,
        name: entry.name,
        keyword: entry.keyword,
        num: entry.num,
        size: entry.size,
        duplicateOf: entry.duplicateOf ?? '',
        status: 'idle',
        pluginId: '',
        title: '',
        message: '',
        coverUrl: ''
      })
    }

    return merged
  })

  /** 可选行：扫描到、且不是重复番号 */
  const selectablePaths = computed(() =>
    rows.value.filter((row) => row.duplicateOf.length === 0).map((row) => row.path)
  )
  const total = computed(() => task.value?.total ?? 0)
  const finished = computed(() => task.value?.finished ?? 0)
  const failed = computed(() => task.value?.failed ?? 0)
  const percentage = computed(() =>
    total.value > 0 ? Math.min(100, Math.round((finished.value / total.value) * 100)) : 0
  )
  const canStart = computed(
    () => !running.value && !scanning.value && !submitting.value && selected.value.length > 0
  )
  const canCancel = computed(() => running.value && task.value !== null)
  const canResume = computed(
    () => !running.value && task.value?.status === 'paused' && task.value.total > task.value.finished
  )

  /** 全部勾选 / 清空勾选 */
  function toggleAll(checked: boolean): void {
    selected.value = checked ? [...selectablePaths.value] : []
  }

  /** 扫描所选数据源的根目录（不递归） */
  async function scan(): Promise<void> {
    const current = connection.value
    if (!current) {
      MessagePlugin.warning('请先选择数据源')
      return
    }
    scanning.value = true
    const result = await scrapeApi.listVideos({ connectionId: current.id, dirPath: dirPath.value })
    scanning.value = false
    if (!isScrapeOk(result)) {
      MessagePlugin.error(result.message)
      return
    }
    entries.value = result.data
    selected.value = result.data.filter((entry) => !entry.duplicateOf).map((entry) => entry.path)
    if (result.data.length === 0) MessagePlugin.info('根目录下没有找到可刮削的视频文件')
  }

  /** 读取任务快照与逐文件结果 */
  async function refreshTask(taskId: string): Promise<void> {
    const result = await scrapeApi.getTask(taskId)
    if (!isScrapeOk(result)) {
      MessagePlugin.error(result.message)
      return
    }
    task.value = result.data.task
    files.value = result.data.files
    dirPath.value = result.data.task.dirPath
    running.value = result.data.task.status === 'running'
  }

  /** 启动任务：勾选的文件必须位于当前根目录下 */
  async function start(): Promise<void> {
    const current = connection.value
    if (!current) {
      MessagePlugin.warning('请先选择数据源')
      return
    }
    submitting.value = true
    const result = await scrapeApi.start({
      connectionId: current.id,
      dirPath: dirPath.value,
      paths: [...selected.value]
    })
    submitting.value = false
    if (!isScrapeOk(result)) {
      MessagePlugin.error(result.message)
      return
    }
    task.value = result.data
    running.value = result.data.status === 'running'
    files.value = []
    await refreshTask(result.data.id)
  }

  /** 取消任务：已完成的结果保留，剩余文件可继续 */
  async function cancel(): Promise<void> {
    const current = task.value
    if (!current) return
    const result = await scrapeApi.cancel(current.id)
    if (!isScrapeOk(result)) {
      MessagePlugin.error(result.message)
      return
    }
    running.value = false
    await refreshTask(current.id)
    MessagePlugin.info('已取消，剩余文件可稍后继续')
  }

  /** 继续被取消或被应用重启中断的任务 */
  async function resume(): Promise<void> {
    const current = task.value
    if (!current) return
    const result = await scrapeApi.resume(current.id)
    if (!isScrapeOk(result)) {
      MessagePlugin.error(result.message)
      return
    }
    running.value = true
    await refreshTask(current.id)
  }

  /** 重新挂载时恢复：主进程在跑就认它，否则回填该数据源最近一次任务 */
  async function restore(): Promise<void> {
    const current = connection.value
    if (!current) {
      reset()
      return
    }
    const latest = await scrapeApi.listTasks(5)
    if (isScrapeOk(latest)) {
      const mine = latest.data.find((item) => item.connectionId === current.id)
      if (mine) {
        await refreshTask(mine.id)
        return
      }
    }
    const busy = await scrapeApi.running()
    running.value = isScrapeOk(busy) && busy.data
    task.value = null
    files.value = []
  }

  function reset(): void {
    dirPath.value = FILE_ROOT
    entries.value = []
    files.value = []
    task.value = null
    selected.value = []
    running.value = false
  }

  function upsertFile(incoming: ScrapeFileItem): void {
    const index = files.value.findIndex((file) => file.id === incoming.id)
    if (index >= 0) files.value.splice(index, 1, incoming)
    else files.value.push(incoming)
  }

  function applyProgress(event: ScrapeProgressEvent): void {
    if (event.task.connectionId !== connection.value?.id) return
    task.value = event.task
    running.value = event.task.status === 'running'
    upsertFile(event.file)
  }

  watch(
    () => connection.value?.id ?? '',
    () => {
      reset()
      void restore()
    }
  )

  onMounted(async () => {
    disposeProgress = scrapeApi.onProgress(applyProgress)
    await restore()
  })

  onUnmounted(() => {
    disposeProgress?.()
    disposeProgress = null
  })

  return {
    dirPath,
    entries,
    files,
    task,
    selected,
    scanning,
    submitting,
    running,
    rows,
    selectablePaths,
    total,
    finished,
    failed,
    percentage,
    canStart,
    canCancel,
    canResume,
    toggleAll,
    scan,
    start,
    cancel,
    resume
  }
}
