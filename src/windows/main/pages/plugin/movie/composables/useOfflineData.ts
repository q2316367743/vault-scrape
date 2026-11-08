/**
 * 离线数据包面板的状态与动作（模块级单例）。
 *
 * 契约：
 * 1. 状态在模块级别共享，页面与面板拿到同一份，避免重复订阅与重复请求；
 * 2. 所有调用都走 `@/api/offline` 的信封：失败只弹提示，不向上抛异常；
 * 3. 进度与完成由主进程单向推送，订阅只在首次使用时建立一次，随应用存活。
 */
import { computed, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { offlineApi } from '@/api/offline'
import type { PluginResult } from '@common/types/plugin'
import {
  OFFLINE_PHASE_LABELS,
  type OfflineCheckResult,
  type OfflinePackStatus,
  type OfflineProgress
} from '@common/types/offline'

const status = ref<OfflinePackStatus | null>(null)
const progress = ref<OfflineProgress | null>(null)
/** 检查 / 启动任务这类短请求的按钮 loading */
const busy = ref(false)
/** 是否有导入任务正在执行 */
const running = ref(false)

let subscribed = false

async function call<T>(
  task: () => Promise<PluginResult<T>>,
  fallback: string
): Promise<T | null> {
  try {
    const result = await task()
    if (result.ok) return result.data
    MessagePlugin.error(result.message || fallback)
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : fallback)
  }
  return null
}

async function refresh(): Promise<void> {
  const next = await call(() => offlineApi.status(), '读取离线数据包状态失败')
  if (next) status.value = next
}

async function check(): Promise<OfflineCheckResult | null> {
  busy.value = true
  const result = await call(() => offlineApi.check(), '检查离线数据包更新失败')
  busy.value = false
  if (!result) return null
  if (result.updateAvailable) {
    MessagePlugin.info(`发现新数据包 ${result.latestPackDate}`)
  } else {
    MessagePlugin.success(
      result.latestPackDate.length > 0 ? `已是最新数据包（${result.latestPackDate}）` : '已是最新数据包'
    )
  }
  await refresh()
  return result
}

async function download(): Promise<void> {
  busy.value = true
  const started = await call(() => offlineApi.update(), '启动下载失败')
  busy.value = false
  if (!started) return
  running.value = true
  progress.value = null
}

async function importLocal(): Promise<void> {
  const started = await call(() => offlineApi.importLocal(), '启动本地导入失败')
  if (!started || started.canceled) return
  running.value = true
  progress.value = null
}

async function cancel(): Promise<void> {
  const result = await call(() => offlineApi.cancel(), '取消失败')
  if (result?.canceled) MessagePlugin.info('已请求取消，正在停止任务…')
}

async function remove(): Promise<void> {
  const result = await call(() => offlineApi.remove(), '删除离线数据包失败')
  if (result?.removed) MessagePlugin.success('离线数据包已删除')
  await refresh()
}

function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  offlineApi.onProgress((next) => {
    progress.value = next
    running.value = next.phase !== 'idle' && next.phase !== 'done' && next.phase !== 'failed'
  })
  offlineApi.onDone((done) => {
    running.value = false
    progress.value = null
    if (done.ok) MessagePlugin.success(done.message)
    else MessagePlugin.error(done.message)
    void refresh()
  })
}

export function useOfflineData() {
  ensureSubscribed()
  return {
    status,
    progress,
    busy,
    running,
    phaseLabel: computed(() => {
      const phase = progress.value?.phase
      return phase ? OFFLINE_PHASE_LABELS[phase] : ''
    }),
    refresh,
    check,
    download,
    importLocal,
    cancel,
    remove
  }
}
