/**
 * 播放状态向窗口的单向推送（主窗口标题栏的「正在播放」标签用）。
 *
 * 契约：只有主窗口订阅，但事件总线只能广播或按窗口定向；这里统一广播，
 * 播放窗口收到后不处理。窗口重新挂载时用 `playerSnapshot` 拉一次快照复原。
 */
import type { PlayerStatus } from '@common/types/player'
import { CORE_EVENTS } from '@common/channels'
import { emit } from '../../runtime/host'

export function broadcastPlayerStatus(status: PlayerStatus): void {
  emit(CORE_EVENTS.playerStatus, status)
}
