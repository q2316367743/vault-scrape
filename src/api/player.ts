/**
 * 播放模块桥。
 *
 * 契约：core 是「窗口在不在、播什么」的权威；播放进度由播放窗口回报给 core，
 * 主窗口的「正在播放」标签订阅 `onStatus` 得到快照。
 */
import type {
  PlayerLoadResult,
  PlayerOpenPayload,
  PlayerState,
  PlayerStatus
} from '@common/types/player'
import { CORE_EVENTS } from '@common/channels'
import { subscribe } from './events'
import { callCore } from './invoke'

export const playerApi = {
  /** 打开播放窗口；已有窗口时换片并聚焦 */
  open: (payload: PlayerOpenPayload): Promise<void> => callCore('playerOpen', payload),

  /** 播放窗口挂载后调用：装载当前待播目标 */
  load: (): Promise<PlayerLoadResult> => callCore('playerLoad'),

  /** 关闭播放窗口 */
  close: (): Promise<void> => callCore('playerClose'),

  /** 拉一次播放状态快照：主窗口标题栏挂载时用它补初值 */
  getStatus: (): Promise<PlayerStatus> => callCore('playerSnapshot'),

  /** 聚焦播放窗口 */
  focus: (): Promise<void> => callCore('playerFocus'),

  /** 播放窗口回报实时状态（core 再广播给主窗口） */
  reportState: (state: PlayerState): Promise<void> => callCore('playerReportState', state),

  /** 窗口已存在时 core 推来的换片结果 */
  onSwitch: (listener: (result: PlayerLoadResult) => void): (() => void) =>
    subscribe(CORE_EVENTS.playerSwitch, listener),

  /** 订阅播放状态，返回取消订阅函数 */
  onState: (listener: (state: PlayerState) => void): (() => void) =>
    subscribe(CORE_EVENTS.playerState, listener),

  /** 订阅布局状态（全屏时收起侧栏与控制条），返回取消订阅函数 */
  onLayout: (listener: (state: unknown) => void): (() => void) =>
    subscribe(CORE_EVENTS.playerLayout, listener),

  /** 订阅播放状态快照（主窗口标题栏），返回取消订阅函数 */
  onStatus: (listener: (status: PlayerStatus) => void): (() => void) =>
    subscribe(CORE_EVENTS.playerStatus, listener)
}

export type PlayerApi = typeof playerApi
