/**
 * 演员补全队列进度向窗口的单向推送。
 *
 * 契约：队列在 core 运行，窗口可能已关闭或切走，因此**广播给所有窗口**；
 * 事件是全量状态快照，渲染层挂载时还要用 `actorScrapeStatus` 拉一次，两者同形。
 */
import type { ActorScrapeStatus } from '@common/types/actor'
import { CORE_EVENTS } from '@common/channels'
import { emit } from '../../runtime/host'

export function broadcastActorScrapeStatus(status: ActorScrapeStatus): void {
  emit(CORE_EVENTS.actorProgress, status)
}
