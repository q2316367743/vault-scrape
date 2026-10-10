/**
 * 工作台（手动刮削入口）的渲染层状态机。
 *
 * 契约：
 * - 这里不扫盘、也不自己算索引：目录浏览走 `scrape:browse`（主进程按资料库配置解析），
 *   所以看到的内容与影视墙、扫描结果完全同源；
 * - 选中影片用条目 ID（`itemId`）排队，路径不再跨 IPC 传递，改名/移动不会找错文件；
 * - 任务进度以主进程 / sqlite 为准（`scrape:getTask` + `scrape:progress`），本 composable
 *   只缓存快照，因此切 tab、关窗口再回来进度不丢；
 * - 任务面板展示的是「主进程里最近的一条任务」，与当前选中的资料库无关；
 *   进度事件只认当前任务 ID，避免多任务串台。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { FILE_ROOT } from '@common/types/file'
import { isLibraryOk, type MediaLibrary } from '@common/types/library'
import type { MediaBrowseEntry } from '@common/types/media'
import { isScrapeOk, type ScrapeProgressEvent, type ScrapeTaskSnapshot } from '@common/types/scrape'
import { libraryApi, scrapeApi } from '@/api'
import { browseMedia } from '@/api/scrape'

/** 面包屑一级 */
export interface WorkspaceCrumb {
  label: string
  path: string
}

/** 工作台状态机：选库 → 逐级浏览 → 勾选影片 → 排队刮削 */
export function useWorkspaceScrape() {
  const libraries = ref<MediaLibrary[]>([])
  const libraryId = ref('')
  const loadingLibraries = ref(false)
  const dirPath = ref<string>(FILE_ROOT)
  const entries = ref<MediaBrowseEntry[]>([])
  const browsing = ref(false)
  const failure = ref('')
  const selected = ref<string[]>([])
  const task = ref<ScrapeTaskSnapshot | null>(null)
  const submitting = ref(false)
  const running = ref(false)

  let disposeProgress: (() => void) | null = null

  const library = computed(
    () => libraries.value.find((item) => item.id === libraryId.value) ?? null
  )
  /** 目录行只用于下钻，可勾选的只有影片 */
  const movies = computed(() => entries.value.filter((entry) => entry.type === 'movie'))
  const selectableIds = computed(() => movies.value.map((entry) => entry.itemId))
  const selectedCount = computed(() => selected.value.length)

  const crumbs = computed<WorkspaceCrumb[]>(() => {
    const list: WorkspaceCrumb[] = [{ label: library.value?.name ?? '资料库', path: FILE_ROOT }]
    if (dirPath.value === FILE_ROOT) return list
    let acc = ''
    for (const segment of dirPath.value.split('/').filter((part) => part.length > 0)) {
      acc += `/${segment}`
      list.push({ label: segment, path: acc })
    }
    return list
  })

  const total = computed(() => task.value?.total ?? 0)
  const finished = computed(() => task.value?.finished ?? 0)
  const failed = computed(() => task.value?.failed ?? 0)
  const percentage = computed(() =>
    total.value > 0 ? Math.min(100, Math.round((finished.value / total.value) * 100)) : 0
  )
  const canStart = computed(
    () =>
      !running.value &&
      !browsing.value &&
      !submitting.value &&
      library.value !== null &&
      selected.value.length > 0
  )
  const canCancel = computed(() => running.value && task.value !== null)
  const canResume = computed(
    () => !running.value && task.value?.status === 'paused' && task.value.total > task.value.finished
  )

  async function loadLibraries(): Promise<void> {
    loadingLibraries.value = true
    const result = await libraryApi.list()
    loadingLibraries.value = false
    if (!isLibraryOk(result)) {
      MessagePlugin.error(result.message)
      return
    }
    libraries.value = result.data
    if (!result.data.some((item) => item.id === libraryId.value)) {
      libraryId.value = result.data.length > 0 ? result.data[0].id : ''
    }
  }

  function selectLibrary(id: unknown): void {
    if (typeof id === 'string') libraryId.value = id
  }

  /** 列出某个目录下的内容；路径是连接内绝对路径，根目录为 `/` */
  async function browse(path: string): Promise<void> {
    const current = library.value
    if (!current) {
      MessagePlugin.warning('请先选择资料库')
      return
    }
    browsing.value = true
    const result = await browseMedia({ libraryId: current.id, dirPath: path })
    browsing.value = false
    if (!isScrapeOk(result)) {
      failure.value = result.message
      MessagePlugin.error(result.message)
      return
    }
    failure.value = ''
    dirPath.value = path
    entries.value = result.data
    const alive = new Set(
      result.data.filter((entry) => entry.type === 'movie').map((entry) => entry.itemId)
    )
    selected.value = selected.value.filter((itemId) => alive.has(itemId))
  }

  function enter(entry: MediaBrowseEntry): void {
    if (entry.type !== 'folder') return
    void browse(entry.path)
  }

  /** 面包屑 / 上一级都走这里：路径由调用方算好，本 composable 只认路径 */
  function goto(path: string): void {
    if (path === dirPath.value) return
    void browse(path)
  }

  function refresh(): void {
    void browse(dirPath.value)
  }

  function toggleOne(itemId: string, checked: boolean): void {
    if (checked) {
      if (selected.value.includes(itemId)) return
      selected.value = [...selected.value, itemId]
      return
    }
    selected.value = selected.value.filter((item) => item !== itemId)
  }

  /** 只有当前目录的影片能参与全选，目录行与历史勾选不受影响 */
  function toggleAll(checked: boolean): void {
    selected.value = checked ? [...selectableIds.value] : []
  }

  async function refreshTask(taskId: string): Promise<void> {
    const result = await scrapeApi.getTask(taskId)
    if (!isScrapeOk(result)) {
      MessagePlugin.error(result.message)
      return
    }
    task.value = result.data.task
    running.value = result.data.task.status === 'running'
  }

  /** 排队：只把条目 ID 交给主进程，由它按资料库配置解析文件与插件 */
  async function start(): Promise<void> {
    const current = library.value
    if (!current) {
      MessagePlugin.warning('请先选择资料库')
      return
    }
    if (selected.value.length === 0) {
      MessagePlugin.warning('请先勾选要刮削的影片')
      return
    }
    submitting.value = true
    const result = await scrapeApi.start({ libraryId: current.id, itemIds: [...selected.value] })
    submitting.value = false
    if (!isScrapeOk(result)) {
      MessagePlugin.error(result.message)
      return
    }
    task.value = result.data
    running.value = result.data.status === 'running'
    MessagePlugin.success(`已排队 ${result.data.total} 个影片，进度见下方任务卡片`)
    selected.value = []
    await refreshTask(result.data.id)
  }

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
    MessagePlugin.info('已取消，剩余影片可稍后继续')
  }

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

  /** 重新挂载时恢复：主进程最近一条任务就是工作台要展示的任务 */
  async function restore(): Promise<void> {
    const latest = await scrapeApi.listTasks(1)
    if (isScrapeOk(latest) && latest.data.length > 0) {
      await refreshTask(latest.data[0].id)
      return
    }
    const busy = await scrapeApi.running()
    running.value = isScrapeOk(busy) && busy.data
    task.value = null
  }

  function applyProgress(event: ScrapeProgressEvent): void {
    const current = task.value
    if (current && event.task.id !== current.id) return
    const wasRunning = running.value
    task.value = event.task
    running.value = event.task.status === 'running'
    // 任务停下来时目录里的「已刮削」状态可能变了，静默刷新一次
    if (wasRunning && !running.value) void browse(dirPath.value)
  }

  function reset(): void {
    dirPath.value = FILE_ROOT
    entries.value = []
    selected.value = []
    failure.value = ''
  }

  watch(
    () => libraryId.value,
    () => {
      reset()
      void browse(FILE_ROOT)
    }
  )

  onMounted(async () => {
    disposeProgress = scrapeApi.onProgress(applyProgress)
    await loadLibraries()
    await restore()
  })

  onUnmounted(() => {
    disposeProgress?.()
    disposeProgress = null
  })

  return {
    libraries,
    libraryId,
    library,
    loadingLibraries,
    dirPath,
    entries,
    browsing,
    failure,
    selected,
    selectedCount,
    movies,
    selectableIds,
    crumbs,
    task,
    submitting,
    running,
    total,
    finished,
    failed,
    percentage,
    canStart,
    canCancel,
    canResume,
    selectLibrary,
    enter,
    goto,
    refresh,
    toggleOne,
    toggleAll,
    start,
    cancel,
    resume
  }
}
