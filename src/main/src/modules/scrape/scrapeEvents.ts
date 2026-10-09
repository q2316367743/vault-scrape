/**
 * 刮削进度向渲染层的单向推送。
 *
 * 契约（参照 file / offline 域的推送）：
 * - 任务在主进程运行，渲染窗口可能已关闭或切走，因此**广播给所有窗口**；
 * - 窗口已销毁时静默丢弃，不重试、不排队；
 * - 事件只是「增量提示」，最终状态以 sqlite 为准（重新挂载后拉快照即可复原）。
 */
import { BrowserWindow } from 'electron'
import type { ScrapeProgressEvent } from '@common/types/scrape'
import { ScrapeChannels } from '~/modules/scrape/scrapeChannels'

export function broadcastScrapeProgress(event: ScrapeProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    const contents = win.webContents
    if (contents.isDestroyed()) continue
    contents.send(ScrapeChannels.progress, event)
  }
}
