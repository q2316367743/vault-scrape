/**
 * 资料库扫描进度向渲染层的单向推送。
 *
 * 契约（与 scrape / file 域的推送一致）：
 * - 扫描在主进程运行，渲染窗口可能已关闭或切走，因此**广播给所有窗口**；
 * - 窗口已销毁时静默丢弃，不重试、不排队；
 * - 事件只是「增量提示」，最终结果以 `library:scan` 的返回值为准。
 */
import { BrowserWindow } from 'electron'
import type { LibraryProgressEvent } from '@common/types/library'
import { LibraryChannels } from '~/modules/library/libraryChannels'

export function broadcastLibraryProgress(event: LibraryProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    const contents = win.webContents
    if (contents.isDestroyed()) continue
    contents.send(LibraryChannels.progress, event)
  }
}
