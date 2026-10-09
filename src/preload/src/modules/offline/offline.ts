import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  OfflineCheckResult,
  OfflineDone,
  OfflinePackStatus,
  OfflineProgress,
  OfflineUpdateNotice
} from '@common/types/offline'
import type { PluginResult } from '@common/types/plugin'
import { OfflineChannels } from './offlineChannels'

/** 任务启动结果：jobId 用于把后续进度事件归属到同一次操作 */
export interface OfflineJobHandle {
  jobId: string
}

/** 本地导入结果：用户取消选择文件时为 false */
export interface OfflineLocalImportHandle {
  jobId: string
  canceled: boolean
}

/**
 * 离线数据包桥。
 *
 * 契约：invoke 一律返回 `PluginResult` 信封而不抛异常；
 * 进度 / 完成走主进程单向推送，订阅函数返回取消订阅函数。
 */
export const offlineApi = {
  status: (): Promise<PluginResult<OfflinePackStatus>> => ipcRenderer.invoke(OfflineChannels.status),

  check: (): Promise<PluginResult<OfflineCheckResult>> => ipcRenderer.invoke(OfflineChannels.check),

  update: (): Promise<PluginResult<OfflineJobHandle>> => ipcRenderer.invoke(OfflineChannels.update),

  importLocal: (): Promise<PluginResult<OfflineLocalImportHandle>> =>
    ipcRenderer.invoke(OfflineChannels.importLocal),

  cancel: (): Promise<PluginResult<{ canceled: boolean }>> =>
    ipcRenderer.invoke(OfflineChannels.cancel),

  remove: (): Promise<PluginResult<{ removed: boolean }>> =>
    ipcRenderer.invoke(OfflineChannels.remove),

  /** 订阅导入进度，返回取消订阅函数 */
  onProgress: (listener: (event: OfflineProgress) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: OfflineProgress): void => listener(payload)
    ipcRenderer.on(OfflineChannels.progress, handler)
    return () => {
      ipcRenderer.removeListener(OfflineChannels.progress, handler)
    }
  },

  /** 订阅任务结束事件，返回取消订阅函数 */
  onDone: (listener: (event: OfflineDone) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: OfflineDone): void => listener(payload)
    ipcRenderer.on(OfflineChannels.done, handler)
    return () => {
      ipcRenderer.removeListener(OfflineChannels.done, handler)
    }
  },

  /** 订阅「上游有新数据包」通知，返回取消订阅函数 */
  onUpdateAvailable: (listener: (event: OfflineUpdateNotice) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: OfflineUpdateNotice): void =>
      listener(payload)
    ipcRenderer.on(OfflineChannels.updateAvailable, handler)
    return () => {
      ipcRenderer.removeListener(OfflineChannels.updateAvailable, handler)
    }
  }
}

export type OfflineApi = typeof offlineApi
