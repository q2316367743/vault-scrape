/**
 * 资料库扫描进度向窗口的单向推送。
 *
 * 契约（与 scrape / file 域的推送一致）：
 * - 扫描在 core 运行，窗口可能已关闭或切走，因此**广播给所有窗口**；
 * - 事件只是「增量提示」，最终结果以扫描调用的返回值为准。
 */
import type { LibraryProgressEvent } from '@common/types/library'
import { CORE_EVENTS } from '@common/channels'
import { emit } from '../../runtime/host'

export function broadcastLibraryProgress(event: LibraryProgressEvent): void {
  emit(CORE_EVENTS.libraryProgress, event)
}
