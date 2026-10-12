import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  PlayerCommand,
  PlayerLoadResult,
  PlayerOpenPayload,
  PlayerProbeResult,
  PlayerState,
  PlayerStatus
} from '@common/types/player'
import type { PlayerLayoutState } from '@common/types/player/layout'
import { PlayerChannels } from './playerChannels'

/**
 * 播放窗口桥。
 *
 * 契约：主进程是播放状态的唯一权威——`load()` 拿到「用哪个后端 + 播什么地址」，
 * 之后的状态一律从 `onState` 推来；渲染层只发命令，不改主进程状态。
 */
export const playerApi = {
  /** 打开播放窗口；已有窗口时换片并聚焦 */
  open: (payload: PlayerOpenPayload): Promise<void> =>
    ipcRenderer.invoke(PlayerChannels.open, payload),

  /** 播放窗口挂载后调用：装载当前待播目标 */
  load: (): Promise<PlayerLoadResult> => ipcRenderer.invoke(PlayerChannels.load),

  /** 播放控制命令；内置播放器后端的命令由渲染层自己处理，主进程只兜 mpv */
  command: (command: PlayerCommand): Promise<void> =>
    ipcRenderer.invoke(PlayerChannels.command, command),

  /** 关闭播放窗口 */
  close: (): Promise<void> => ipcRenderer.invoke(PlayerChannels.close),

  /** 检测 mpv：传空串表示按自动探测结果回答 */
  detect: (path: string): Promise<PlayerProbeResult> =>
    ipcRenderer.invoke(PlayerChannels.detect, path),

  /** 拉一次播放状态快照：主窗口标题栏挂载时用它补初值（此后的变化走 onStatus） */
  getStatus: (): Promise<PlayerStatus> => ipcRenderer.invoke(PlayerChannels.snapshot),

  /** 聚焦播放窗口；窗口最小化过会先还原 */
  focus: (): Promise<void> => ipcRenderer.invoke(PlayerChannels.focus),

  /** 窗口已存在时主进程推来的换片结果 */
  onSwitch: (listener: (result: PlayerLoadResult) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, result: PlayerLoadResult): void => listener(result)
    ipcRenderer.on(PlayerChannels.switch, handler)
    return () => {
      ipcRenderer.removeListener(PlayerChannels.switch, handler)
    }
  },

  /** 订阅播放状态，返回取消订阅函数（组件卸载时必须调用） */
  onState: (listener: (state: PlayerState) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, state: PlayerState): void => listener(state)
    ipcRenderer.on(PlayerChannels.state, handler)
    return () => {
      ipcRenderer.removeListener(PlayerChannels.state, handler)
    }
  },

  /** 订阅布局状态（全屏时渲染层收起侧栏与控制条），返回取消订阅函数 */
  onLayout: (listener: (state: PlayerLayoutState) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, state: PlayerLayoutState): void => listener(state)
    ipcRenderer.on(PlayerChannels.layout, handler)
    return () => {
      ipcRenderer.removeListener(PlayerChannels.layout, handler)
    }
  },

  /** 订阅播放状态快照（主窗口标题栏的「正在播放」标签），返回取消订阅函数 */
  onStatus: (listener: (status: PlayerStatus) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, status: PlayerStatus): void => listener(status)
    ipcRenderer.on(PlayerChannels.status, handler)
    return () => {
      ipcRenderer.removeListener(PlayerChannels.status, handler)
    }
  }
}

export type PlayerApi = typeof playerApi
