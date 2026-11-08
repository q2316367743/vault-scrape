/**
 * 离线数据包桥：invoke 返回 `PluginResult` 信封；进度 / 完成 / 新版本通知走事件。
 */
import type {
  OfflineCheckResult,
  OfflineDone,
  OfflinePackStatus,
  OfflineProgress,
  OfflineUpdateNotice
} from '@common/types/offline'
import type { PluginResult } from '@common/types/plugin'
import { CORE_EVENTS } from '@common/channels'
import { subscribe } from './events'
import { callCore } from './invoke'
import { runJob } from './job'

export interface OfflineJobHandle {
  jobId: string
}

export interface OfflineLocalImportHandle {
  jobId: string
  canceled: boolean
}

export const offlineApi = {
  status: (): Promise<PluginResult<OfflinePackStatus>> => callCore('offlineStatus'),

  check: (): Promise<PluginResult<OfflineCheckResult>> => callCore('offlineCheck'),

  update: (): Promise<PluginResult<OfflineJobHandle>> => callCore('offlineUpdate'),

  /** 选文件框可能停留很久，走长任务通道 */
  importLocal: (): Promise<PluginResult<OfflineLocalImportHandle>> =>
    runJob('offline.importLocal'),

  cancel: (): Promise<PluginResult<{ canceled: boolean }>> => callCore('offlineCancel'),

  remove: (): Promise<PluginResult<{ removed: boolean }>> => callCore('offlineRemove'),

  /** 订阅导入进度，返回取消订阅函数 */
  onProgress: (listener: (event: OfflineProgress) => void): (() => void) =>
    subscribe(CORE_EVENTS.offlineProgress, listener),

  /** 订阅任务结束事件，返回取消订阅函数 */
  onDone: (listener: (event: OfflineDone) => void): (() => void) =>
    subscribe(CORE_EVENTS.offlineDone, listener),

  /** 订阅「上游有新数据包」通知，返回取消订阅函数 */
  onUpdateAvailable: (listener: (event: OfflineUpdateNotice) => void): (() => void) =>
    subscribe(CORE_EVENTS.offlineUpdateAvailable, listener)
}

export type OfflineApi = typeof offlineApi
