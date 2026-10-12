/**
 * 概览页的演员补全数据源：主进程串行补全队列的实时状态。
 *
 * 契约：
 * - 队列在主进程跑（刮削入库后自动补全与演员页「补全缺失资料」共用它），
 *   本组合式只做「挂载拉一次快照 + 订阅全量状态事件」；
 * - 事件是全量状态而不是增量字段，直接覆盖本地值，不做合并；
 * - 卸载时退订，队列在主进程照跑，重新挂载即可复原当前进度。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { isActorOk, type ActorScrapeStatus } from '@common/types/actor'
import { actorApi } from '@/api'
import { toPercentage } from './useScrapeTaskDisplay'

const EMPTY_STATUS: ActorScrapeStatus = {
  total: 0,
  finished: 0,
  failed: 0,
  pending: 0,
  running: false,
  currentName: '',
  updatedAt: 0
}

export function useActorScrape() {
  const status = ref<ActorScrapeStatus>({ ...EMPTY_STATUS })

  let disposeProgress: (() => void) | null = null

  /** 是否有一轮补全可展示（跑空后仍保留最后一轮的数字） */
  const hasTask = computed(() => status.value.total > 0)
  const percentage = computed(() => toPercentage(status.value.finished, status.value.total))

  async function loadStatus(): Promise<void> {
    const result = await actorApi.scrapeStatus()
    if (isActorOk(result)) status.value = result.data
  }

  onMounted(() => {
    disposeProgress = actorApi.onScrapeProgress((next) => {
      status.value = next
    })
    void loadStatus()
  })

  onUnmounted(() => {
    disposeProgress?.()
    disposeProgress = null
  })

  return { status, hasTask, percentage, loadStatus }
}
