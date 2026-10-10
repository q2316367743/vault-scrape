import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  LibraryProgressEvent,
  LibraryResult,
  LibraryScanResult,
  LibraryTaskResult,
  MediaLibrary,
  MediaLibraryDraft
} from '@common/types/library'
import { LibraryChannels } from './libraryChannels'

/**
 * 资料库模块桥。
 *
 * 契约：所有 invoke 都返回 `LibraryResult` 信封而**不抛异常**
 * （contextBridge 传递自定义错误的附加属性并不可靠，code 会丢失）。
 */
export const libraryApi = {
  list: (): Promise<LibraryResult<MediaLibrary[]>> => ipcRenderer.invoke(LibraryChannels.list),

  save: (draft: MediaLibraryDraft): Promise<LibraryResult<MediaLibrary>> =>
    ipcRenderer.invoke(LibraryChannels.save, { draft }),

  remove: (libraryId: string): Promise<LibraryResult<boolean>> =>
    ipcRenderer.invoke(LibraryChannels.remove, { libraryId }),

  /** 递归扫描；期间用 `onProgress` 推进度，扫描完成后才 resolve */
  scan: (libraryId: string): Promise<LibraryResult<LibraryScanResult>> =>
    ipcRenderer.invoke(LibraryChannels.scan, { libraryId }),

  cancelScan: (): Promise<LibraryResult<boolean>> => ipcRenderer.invoke(LibraryChannels.cancelScan),

  /** 刮削已扫描的影视；返回任务快照 ID 与队列条数 */
  scrape: (libraryId: string): Promise<LibraryResult<LibraryTaskResult>> =>
    ipcRenderer.invoke(LibraryChannels.scrape, { libraryId }),

  /** 主进程是否有扫描在跑：扫描不受窗口开关影响，状态从主进程读 */
  running: (): Promise<LibraryResult<boolean>> => ipcRenderer.invoke(LibraryChannels.running),

  /** 订阅扫描进度，返回取消订阅函数 */
  onProgress: (listener: (event: LibraryProgressEvent) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: LibraryProgressEvent): void =>
      listener(payload)
    ipcRenderer.on(LibraryChannels.progress, handler)
    return () => {
      ipcRenderer.removeListener(LibraryChannels.progress, handler)
    }
  }
}

export type LibraryApi = typeof libraryApi
