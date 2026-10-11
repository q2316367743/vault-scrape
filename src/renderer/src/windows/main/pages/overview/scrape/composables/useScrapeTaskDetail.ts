/**
 * 刮削进度详情取数：从路由 query 读 `taskId`，向主进程要「任务快照 + 逐文件结果」。
 *
 * 契约：
 * - 参数缺失（手改地址栏、旧书签）时只写中文 failure，不发请求、不抛异常；
 * - 逐文件结果是全量快照（`scrape:getTask` 一次返回），进度事件只用来补齐增量；
 * - 进度事件只认当前任务 ID，避免多任务串台；非当前任务的事件直接丢弃。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { isScrapeOk, type ScrapeFileItem, type ScrapeProgressEvent, type ScrapeTaskSnapshot } from '@common/types/scrape'
import { scrapeApi } from '@/api'

export function useScrapeTaskDetail() {
  const route = useRoute()
  const taskId = typeof route.query.taskId === 'string' ? route.query.taskId : ''

  const task = ref<ScrapeTaskSnapshot | null>(null)
  const files = ref<ScrapeFileItem[]>([])
  const loading = ref(false)
  const failure = ref('')

  let disposeProgress: (() => void) | null = null

  async function load(): Promise<void> {
    if (taskId.length === 0) {
      failure.value = '地址里缺少刮削任务参数，请从概览的刮削记录里点进来'
      return
    }
    loading.value = true
    failure.value = ''
    const result = await scrapeApi.getTask(taskId)
    loading.value = false
    if (!isScrapeOk(result)) {
      failure.value = result.message
      return
    }
    task.value = result.data.task
    files.value = result.data.files
  }

  function applyProgress(event: ScrapeProgressEvent): void {
    if (event.task.id !== taskId) return
    task.value = event.task
    const index = files.value.findIndex((item) => item.id === event.file.id)
    if (index >= 0) files.value[index] = event.file
    else files.value = [...files.value, event.file]
  }

  onMounted(async () => {
    disposeProgress = scrapeApi.onProgress(applyProgress)
    await load()
  })

  onUnmounted(() => {
    disposeProgress?.()
    disposeProgress = null
  })

  return { taskId, task, files, loading, failure, load }
}
