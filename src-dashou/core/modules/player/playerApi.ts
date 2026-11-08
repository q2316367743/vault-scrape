/**
 * 播放域的 core API。
 *
 * 契约：
 * - core 是「播什么、窗口在不在」的唯一权威，播放进度由播放窗口回报；
 * - `playerLoad` 由播放页挂载时调用，返回待播目标并显示窗口；
 * - 播放控制（播放 / 暂停 / 进度 / 音量 / 全屏）全部在播放窗口内完成，
 *   不再经过 core（插件没有 mpv，内置播放器自己就是权威）。
 */
import {
  type PlayerLoadResult,
  type PlayerOpenPayload,
  type PlayerState,
  type PlayerStatus
} from '@common/types/player'
import { readNumber, readString, toSource } from '@common/types/setting/shared'
import { broadcastPlayerStatus } from './playerEvents'
import { reportState } from './playerSession'
import {
  closePlayerWindow,
  focusPlayerWindow,
  openPlayerWindow,
  playerStatus,
  takePlayerTarget
} from './playerWindow'

/** 渲染层来的载荷一律当脏数据读：字段缺失就丢弃，不让它把 core 带崩 */
function readOpenPayload(payload: unknown): PlayerOpenPayload | null {
  const source = toSource(payload)
  if (!source) return null
  const itemId = readString(source, 'itemId', '').trim()
  if (itemId.length === 0) return null
  const episodeId = readString(source, 'episodeId', '').trim()
  return episodeId.length > 0 ? { itemId, episodeId } : { itemId }
}

function readState(payload: unknown): PlayerState | null {
  const source = toSource(payload)
  if (!source) return null
  return {
    backend: 'html5',
    ready: source.ready === true,
    paused: source.paused !== false,
    position: readNumber(source, 'position', 0),
    duration: readNumber(source, 'duration', 0),
    volume: readNumber(source, 'volume', 0.8),
    muted: source.muted === true,
    rate: readNumber(source, 'rate', 1),
    buffering: source.buffering === true,
    ended: source.ended === true,
    error: readString(source, 'error', '')
  }
}

export const playerApi = {
  playerOpen: async (_ctx: unknown, payload: unknown): Promise<void> => {
    const target = readOpenPayload(payload)
    if (!target) return
    await openPlayerWindow(target)
  },

  playerLoad: (): Promise<PlayerLoadResult> => takePlayerTarget(),

  playerClose: async (): Promise<void> => {
    await closePlayerWindow()
  },

  playerSnapshot: (): PlayerStatus => playerStatus(),

  playerFocus: async (): Promise<void> => {
    await focusPlayerWindow()
  },

  /** 播放窗口回报实时状态；core 只存快照并广播给主窗口的「正在播放」标签 */
  playerReportState: async (_ctx: unknown, payload: unknown): Promise<void> => {
    const state = readState(payload)
    if (!state) return
    reportState(state)
    broadcastPlayerStatus(playerStatus())
  }
}
