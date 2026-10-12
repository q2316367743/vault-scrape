/**
 * 播放状态向渲染层的单向推送（主窗口标题栏的「正在播放」标签用）。
 *
 * 契约（参照 file / offline / scrape 域的推送）：
 * - 主窗口句柄没有对外暴露，且只有它是订阅方，所以**广播给所有窗口**：
 *   播放窗口与宿主窗口的 preload 也挂了这个通道，但它们的页面不订阅，收到即丢；
 * - 窗口已销毁时静默丢弃，不重试、不排队；
 * - 事件只是「增量提示」，渲染层重新挂载时用 `player:snapshot` 拉一次当前快照复原。
 */
import { BrowserWindow } from 'electron'
import type { PlayerStatus } from '@common/types/player'
import { PlayerChannels } from '~/modules/player/playerChannels'

export function broadcastPlayerStatus(status: PlayerStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    const contents = win.webContents
    if (contents.isDestroyed()) continue
    contents.send(PlayerChannels.status, status)
  }
}
