/**
 * 离线数据包向渲染层的单向推送。
 *
 * 契约（参照 file 域的 transfer 通道）：
 * - 进度 / 完成事件只推给发起任务的窗口，窗口已销毁则静默丢弃；
 * - 「有新版本」的通知广播给所有窗口，避免多窗口时漏掉提示。
 */
import { BrowserWindow, type WebContents } from 'electron'
import { OfflineChannels } from '~/modules/offline/offlineChannels'
import type { OfflineDone, OfflineProgress, OfflineUpdateNotice } from '@common/types/offline'

function isAlive(sender: WebContents): boolean {
  return !sender.isDestroyed()
}

export function sendOfflineProgress(sender: WebContents, progress: OfflineProgress): void {
  if (!isAlive(sender)) return
  sender.send(OfflineChannels.progress, progress)
}

export function sendOfflineDone(sender: WebContents, done: OfflineDone): void {
  if (!isAlive(sender)) return
  sender.send(OfflineChannels.done, done)
}

/** 广播「上游有新数据包」（自动检查命中时使用） */
export function broadcastOfflineUpdate(notice: OfflineUpdateNotice): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    const contents = win.webContents
    if (contents.isDestroyed()) continue
    contents.send(OfflineChannels.updateAvailable, notice)
  }
}
