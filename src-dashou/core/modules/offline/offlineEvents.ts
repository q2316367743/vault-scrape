/**
 * 离线数据包向窗口的单向推送。
 *
 * 契约：宿主的事件总线只能广播或按窗口定向，本插件只有主窗口消费这些事件，
 * 因此统一广播；窗口不在时宿主会静默丢弃。
 */
import type { OfflineDone, OfflineProgress, OfflineUpdateNotice } from '@common/types/offline'
import { CORE_EVENTS } from '@common/channels'
import { emit } from '../../runtime/host'

export function sendOfflineProgress(progress: OfflineProgress): void {
  emit(CORE_EVENTS.offlineProgress, progress)
}

export function sendOfflineDone(done: OfflineDone): void {
  emit(CORE_EVENTS.offlineDone, done)
}

/** 广播「上游有新数据包」（自动检查命中时使用） */
export function broadcastOfflineUpdate(notice: OfflineUpdateNotice): void {
  emit(CORE_EVENTS.offlineUpdateAvailable, notice)
}
