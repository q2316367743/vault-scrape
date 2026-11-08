/**
 * 刮削进度向窗口的单向推送。
 *
 * 契约：任务在 core 运行，窗口可能已关闭或切走，因此**广播给所有窗口**；
 * 事件只是「增量提示」，最终状态以 sqlite 为准（重新挂载后拉快照即可复原）。
 */
import type { ScrapeProgressEvent } from '@common/types/scrape'
import { CORE_EVENTS } from '@common/channels'
import { emit } from '../../runtime/host'

export function broadcastScrapeProgress(event: ScrapeProgressEvent): void {
  emit(CORE_EVENTS.scrapeProgress, event)
}
