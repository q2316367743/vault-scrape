/**
 * 演员补全队列进度向渲染层的单向推送。
 *
 * 契约（参照 scrape / library 域的推送）：
 * - 队列在主进程运行，渲染窗口可能已关闭或切走，因此**广播给所有窗口**；
 * - 窗口已销毁时静默丢弃，不重试、不排队；
 * - 事件是全量状态快照，渲染层挂载时还要用 `actor:scrapeStatus` 拉一次，
 *   两者同形（覆盖即可，不做字段合并）。
 */
import { BrowserWindow } from 'electron'
import type { ActorScrapeStatus } from '@common/types/actor'
import { ActorChannels } from '~/modules/actor/actorChannels'

export function broadcastActorScrapeStatus(status: ActorScrapeStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    const contents = win.webContents
    if (contents.isDestroyed()) continue
    contents.send(ActorChannels.progress, status)
  }
}
