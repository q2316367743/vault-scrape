/**
 * 概览页的刮削数据源：任务统计 + 当前任务进度 + 刮削记录分页。
 *
 * 契约：
 * - 统计与记录读 sqlite（`dbApi.task.*`，无信封、不抛异常）；「当前任务」读主进程
 *   （`scrapeApi.listTasks(1)` 即最近一条任务），与资料库抽屉里发起的整库刮削同源；
 * - 进度事件只是增量提示：只认当前任务 ID（或当前任务已停下时接管新任务），
 *   任务由运行转停下时再整体刷新一次统计与记录，保证落库结果最终一致；
 * - 取消 / 继续只操作当前任务，动作完成后重新拉任务快照，不做本地乐观更新。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { isScrapeOk, type ScrapeProgressEvent, type ScrapeTaskSnapshot } from '@common/types/scrape'
import type { TaskItem, TaskStats } from '@common/types/task'
import { dbApi, scrapeApi } from '@/api'
import { toPercentage } from './useScrapeTaskDisplay'

const EMPTY_STATS: TaskStats = {
  total: 0,
  pending: 0,
  running: 0,
  success: 0,
  failed: 0,
  paused: 0,
  interrupted: 0
}

export function useScrapeOverview() {
  const stats = ref<TaskStats>({ ...EMPTY_STATS })
  const tasks = ref<TaskItem[]>([])
  const recordsTotal = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const loadingTasks = ref(false)
  const task = ref<ScrapeTaskSnapshot | null>(null)
  const running = ref(false)
  const acting = ref(false)

  let disposeProgress: (() => void) | null = null

  const total = computed(() => task.value?.total ?? 0)
  const finished = computed(() => task.value?.finished ?? 0)
  const failed = computed(() => task.value?.failed ?? 0)
  const percentage = computed(() => toPercentage(finished.value, total.value))
  const canCancel = computed(() => running.value && task.value !== null)
  const canResume = computed(
    () => !running.value && task.value?.status === 'paused' && task.value.total > task.value.finished
  )

  async function loadStats(): Promise<void> {
    stats.value = await dbApi.task.stats()
  }

  async function loadTasks(): Promise<void> {
    loadingTasks.value = true
    try {
      const query = { offset: (page.value - 1) * pageSize.value, limit: pageSize.value }
      const [rows, count] = await Promise.all([dbApi.task.list(query), dbApi.task.count(query)])
      tasks.value = rows
      recordsTotal.value = count
    } finally {
      loadingTasks.value = false
    }
  }

  /** 主进程最近一条任务就是「当前任务」；没有任务时只同步 running 标记 */
  async function refreshTask(taskId: string): Promise<void> {
    const result = await scrapeApi.getTask(taskId)
    if (!isScrapeOk(result)) {
      MessagePlugin.error(result.message)
      return
    }
    task.value = result.data.task
    running.value = result.data.task.status === 'running'
  }

  async function loadCurrent(): Promise<void> {
    const latest = await scrapeApi.listTasks(1)
    if (isScrapeOk(latest) && latest.data.length > 0) {
      await refreshTask(latest.data[0].id)
      return
    }
    const busy = await scrapeApi.running()
    running.value = isScrapeOk(busy) && busy.data
    task.value = null
  }

  async function cancel(): Promise<void> {
    const current = task.value
    if (!current) return
    acting.value = true
    const result = await scrapeApi.cancel(current.id)
    if (isScrapeOk(result)) {
      running.value = false
      await refreshTask(current.id)
      await MessagePlugin.info('已取消，剩余影片可稍后继续')
    } else {
      MessagePlugin.error(result.message)
    }
    acting.value = false
  }

  async function resume(): Promise<void> {
    const current = task.value
    if (!current) return
    acting.value = true
    const result = await scrapeApi.resume(current.id)
    if (isScrapeOk(result)) {
      running.value = true
      await refreshTask(current.id)
    } else {
      MessagePlugin.error(result.message)
    }
    acting.value = false
  }

  /** 进度事件只更新命中的那一行；任务由运行转停时整体刷新，收敛到落库结果 */
  function applyProgress(event: ScrapeProgressEvent): void {
    const current = task.value
    const adopt = current === null || event.task.id === current.id || current.status !== 'running'
    const wasRunning = running.value
    if (adopt) {
      task.value = event.task
      running.value = event.task.status === 'running'
    }
    const index = tasks.value.findIndex((item) => item.id === event.task.id)
    if (index >= 0) tasks.value[index] = event.task
    if (wasRunning && !running.value) {
      void loadStats()
      void loadTasks()
    }
  }

  function resetToFirstPage(): void {
    if (page.value === 1) {
      void loadTasks()
      return
    }
    page.value = 1
  }

  watch(pageSize, resetToFirstPage)
  watch(page, () => {
    void loadTasks()
  })

  onMounted(async () => {
    disposeProgress = scrapeApi.onProgress(applyProgress)
    await Promise.all([loadStats(), loadTasks(), loadCurrent()])
  })

  onUnmounted(() => {
    disposeProgress?.()
    disposeProgress = null
  })

  return {
    stats,
    tasks,
    recordsTotal,
    page,
    pageSize,
    loadingTasks,
    task,
    running,
    acting,
    total,
    finished,
    failed,
    percentage,
    canCancel,
    canResume,
    loadStats,
    loadTasks,
    cancel,
    resume
  }
}
