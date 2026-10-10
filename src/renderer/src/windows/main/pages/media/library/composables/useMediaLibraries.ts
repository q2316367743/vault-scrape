/**
 * 资料库的增删改与两个动作（扫描影视 / 刮削已扫描的影视）。
 *
 * 契约：
 * - 数据真相在主进程：`libraryApi.list()` 给配置，影视墙读模型给每个库的影片计数
 *   （`mediaApi.wall({ libraryId: '' }).libraries`），两者一起加载，保证计数与墙面同口径；
 * - 扫描是长任务：`scan()` 在扫描结束后才 resolve，期间的进度靠 `library:progress` 事件；
 *   取消扫描同样会让 `scan()` 以失败信封（code 为 `cancelled`）返回，界面按 warning 提示；
 * - 按钮忙碌态（`busyId`）只表达「这个库正在被操作」，扫描中禁止重复点击；
 * - 任何写操作后都会 `load()` 并回调 `onChanged`，由页面决定是否重拉影视墙。
 */
import { ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { libraryApi, mediaApi } from '@/api'
import type {
  LibraryProgressEvent,
  MediaLibrary,
  MediaLibraryDraft,
  MediaLibrarySummary
} from '@common/types/library'

export interface UseMediaLibrariesOptions {
  /** 资料库配置或影片归库发生变化时的回调（页面据此重拉影视墙） */
  onChanged?: () => void
}

export function useMediaLibraries(options: UseMediaLibrariesOptions = {}) {
  const libraries = ref<MediaLibrary[]>([])
  const summaries = ref<MediaLibrarySummary[]>([])
  const loading = ref(false)
  const failure = ref('')
  /** 是否有扫描在跑（主进程单例，重开窗口也要能恢复） */
  const scanning = ref(false)
  /** 正在被操作的资料库 ID */
  const busyId = ref('')
  /** 最近一条扫描进度，扫描结束后清空 */
  const progress = ref<LibraryProgressEvent | null>(null)
  let unsubscribe: (() => void) | null = null

  async function load(): Promise<void> {
    loading.value = true
    const [list, wall] = await Promise.all([libraryApi.list(), mediaApi.wall({ libraryId: '' })])
    loading.value = false
    if (!list.ok) {
      failure.value = list.message
      return
    }
    failure.value = ''
    libraries.value = list.data
    if (wall.ok) summaries.value = wall.data.libraries
  }

  function summaryOf(libraryId: string): MediaLibrarySummary | undefined {
    return summaries.value.find((item) => item.id === libraryId)
  }

  /** 订阅扫描进度（挂载时调用一次即可） */
  function subscribe(): void {
    if (unsubscribe) return
    unsubscribe = libraryApi.onProgress((event) => {
      progress.value = event
    })
  }

  /** 窗口重开后恢复「扫描中」状态：扫描不受窗口开关影响 */
  async function restore(): Promise<void> {
    const result = await libraryApi.running()
    if (result.ok) scanning.value = result.data
  }

  function dispose(): void {
    unsubscribe?.()
    unsubscribe = null
  }

  async function save(draft: MediaLibraryDraft): Promise<boolean> {
    const result = await libraryApi.save(draft)
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return false
    }
    MessagePlugin.success(draft.id ? `已更新「${result.data.name}」` : `已创建「${result.data.name}」`)
    await load()
    options.onChanged?.()
    return true
  }

  async function remove(library: MediaLibrary): Promise<void> {
    const result = await libraryApi.remove(library.id)
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return
    }
    MessagePlugin.success(`已删除「${library.name}」`)
    await load()
    options.onChanged?.()
  }

  /** 扫描影视：递归索引整库，随后主进程按设置决定要不要自动刮削 */
  async function scan(library: MediaLibrary): Promise<void> {
    if (scanning.value) return
    scanning.value = true
    busyId.value = library.id
    progress.value = null
    try {
      const result = await libraryApi.scan(library.id)
      if (!result.ok) {
        MessagePlugin.warning(result.message)
        return
      }
      const data = result.data
      const removed = data.removedItems > 0 ? `，移除 ${data.removedItems} 个` : ''
      MessagePlugin.success(
        `「${library.name}」扫描完成：索引 ${data.indexedFiles} 个文件（视频 ${data.indexedVideos} 个）${removed}，待刮削 ${data.pending} 个`
      )
      if (data.message.length > 0) MessagePlugin.warning(data.message)
      if (data.autoScrape) {
        MessagePlugin.info(
          `已自动开始刮削「${library.name}」：${data.autoScrape.total} 个文件，进度见工作台`
        )
      } else if (data.autoScrapeSkipped.length > 0) {
        MessagePlugin.info(`未自动刮削：${data.autoScrapeSkipped}`)
      }
    } finally {
      scanning.value = false
      busyId.value = ''
      progress.value = null
      await load()
      options.onChanged?.()
    }
  }

  async function cancelScan(): Promise<void> {
    const result = await libraryApi.cancelScan()
    if (!result.ok) MessagePlugin.error(result.message)
  }

  /** 刮削已扫描的影视：主进程只把「尚未刮削」的条目排进队 */
  async function scrape(library: MediaLibrary): Promise<void> {
    busyId.value = library.id
    try {
      const result = await libraryApi.scrape(library.id)
      if (!result.ok) {
        MessagePlugin.error(result.message)
        return
      }
      MessagePlugin.success(
        `已为「${library.name}」排队 ${result.data.total} 个文件，进度见工作台任务列表`
      )
      await load()
      options.onChanged?.()
    } finally {
      busyId.value = ''
    }
  }

  return {
    libraries,
    summaries,
    loading,
    failure,
    scanning,
    busyId,
    progress,
    summaryOf,
    subscribe,
    restore,
    dispose,
    load,
    save,
    remove,
    scan,
    cancelScan,
    scrape
  }
}
