import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  ConnectionTestResult,
  FileConnection,
  FileConnectionDraft,
  FileCopyRequest,
  FileCreateRequest,
  FileDownloadRequest,
  FileEntry,
  FileMkdirRequest,
  FileMoveRequest,
  FileRemoveRequest,
  FileResult,
  FileTargetRequest,
  FileTransferDoneEvent,
  FileTransferProgressEvent,
  FileTransferStart,
  FileUploadRequest,
  FileWriteTextRequest
} from '@common/types/file'
import { FileChannels } from './fileChannels'

/**
 * 文件模块桥。
 *
 * 契约：所有 invoke 都返回 `FileResult` 信封而**不抛异常**
 * （contextBridge 传递自定义错误的附加属性并不可靠，code 会丢失）。
 */
export const fileApi = {
  listConnections: (): Promise<FileResult<FileConnection[]>> =>
    ipcRenderer.invoke(FileChannels.listConnections),

  saveConnection: (draft: FileConnectionDraft): Promise<FileResult<FileConnection>> =>
    ipcRenderer.invoke(FileChannels.saveConnection, draft),

  deleteConnection: (connectionId: string): Promise<FileResult<boolean>> =>
    ipcRenderer.invoke(FileChannels.deleteConnection, connectionId),

  testConnection: (draft: FileConnectionDraft): Promise<FileResult<ConnectionTestResult>> =>
    ipcRenderer.invoke(FileChannels.testConnection, draft),

  disposeConnection: (connectionId: string): Promise<FileResult<boolean>> =>
    ipcRenderer.invoke(FileChannels.disposeConnection, connectionId),

  list: (request: FileTargetRequest): Promise<FileResult<FileEntry[]>> =>
    ipcRenderer.invoke(FileChannels.list, request),

  stat: (request: FileTargetRequest): Promise<FileResult<FileEntry>> =>
    ipcRenderer.invoke(FileChannels.stat, request),

  exists: (request: FileTargetRequest): Promise<FileResult<boolean>> =>
    ipcRenderer.invoke(FileChannels.exists, request),

  readText: (request: FileTargetRequest): Promise<FileResult<string>> =>
    ipcRenderer.invoke(FileChannels.readText, request),

  mkdir: (request: FileMkdirRequest): Promise<FileResult<void>> =>
    ipcRenderer.invoke(FileChannels.mkdir, request),

  createFile: (request: FileCreateRequest): Promise<FileResult<void>> =>
    ipcRenderer.invoke(FileChannels.createFile, request),

  writeText: (request: FileWriteTextRequest): Promise<FileResult<void>> =>
    ipcRenderer.invoke(FileChannels.writeText, request),

  move: (request: FileMoveRequest): Promise<FileResult<void>> =>
    ipcRenderer.invoke(FileChannels.move, request),

  copy: (request: FileCopyRequest): Promise<FileResult<void>> =>
    ipcRenderer.invoke(FileChannels.copy, request),

  remove: (request: FileRemoveRequest): Promise<FileResult<void>> =>
    ipcRenderer.invoke(FileChannels.remove, request),

  upload: (request: FileUploadRequest): Promise<FileResult<FileTransferStart>> =>
    ipcRenderer.invoke(FileChannels.upload, request),

  download: (request: FileDownloadRequest): Promise<FileResult<FileTransferStart>> =>
    ipcRenderer.invoke(FileChannels.download, request),

  cancelTransfer: (transferId: string): Promise<FileResult<boolean>> =>
    ipcRenderer.invoke(FileChannels.cancelTransfer, transferId),

  /** 订阅传输进度，返回取消订阅函数 */
  onTransferProgress: (listener: (event: FileTransferProgressEvent) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: FileTransferProgressEvent): void =>
      listener(payload)
    ipcRenderer.on(FileChannels.transferProgress, handler)
    return () => {
      ipcRenderer.removeListener(FileChannels.transferProgress, handler)
    }
  },

  /** 订阅传输结束事件，返回取消订阅函数 */
  onTransferDone: (listener: (event: FileTransferDoneEvent) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: FileTransferDoneEvent): void =>
      listener(payload)
    ipcRenderer.on(FileChannels.transferDone, handler)
    return () => {
      ipcRenderer.removeListener(FileChannels.transferDone, handler)
    }
  }
}

export type FileApi = typeof fileApi
