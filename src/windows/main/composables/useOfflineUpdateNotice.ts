/**
 * 启动时的离线数据包更新提示。
 *
 * 契约：
 * 1. 检查由主进程按 7 天间隔在启动时触发，这里只负责展示，**绝不自动下载**；
 * 2. 每次启动最多提示一次（含「启动时状态里已存在新版本」的情况）；
 * 3. 不阻塞启动：状态读取失败时静默。
 */
import { onMounted, onUnmounted } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { offlineApi } from '@/api/offline'

export function useOfflineUpdateNotice(): void {
  let notified = false

  const notify = (latestPackDate: string, packDate: string): void => {
    if (notified || latestPackDate.length === 0) return
    notified = true
    MessagePlugin.info(
      `离线数据包有新版本 ${latestPackDate}（当前 ${packDate || '未安装'}），可在插件页更新`
    )
  }

  // 先订阅再读状态：启动检查的广播可能早于 onMounted
  const off = offlineApi.onUpdateAvailable((notice) =>
    notify(notice.latestPackDate, notice.packDate)
  )

  onMounted(async () => {
    const result = await offlineApi.status()
    if (result.ok && result.data.updateAvailable) {
      notify(result.data.latestPackDate, result.data.packDate)
    }
  })

  onUnmounted(off)
}
