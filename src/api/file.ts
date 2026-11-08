/**
 * 文件模块桥：所有调用都返回 `FileResult` 信封，不抛异常；传输进度走事件。
 */
import type {
  ConnectionTestResult,
  FileConnection,
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
import { CORE_EVENTS } from '@common/channels'
import { subscribe } from './events'
import { callCore } from './invoke'
import { runJob } from './job'

export const fileApi = {
  listConnections: (): Promise<FileResult<FileConnection[]>> => callCore('fileListConnections'),

  saveConnection: (draft: unknown): Promise<FileResult<FileConnection>> =>
    callCore('fileSaveConnection', draft),

  deleteConnection: (connectionId: string): Promise<FileResult<boolean>> =>
    callCore('fileDeleteConnection', connectionId),

  /** 连接测试可能等远端握手，走长任务通道 */
  testConnection: (draft: unknown): Promise<FileResult<ConnectionTestResult>> =>
    runJob('file.testConnection', draft),

  disposeConnection: (connectionId: string): Promise<FileResult<boolean>> =>
    callCore('fileDisposeConnection', connectionId),

  list: (request: FileTargetRequest): Promise<FileResult<FileEntry[]>> =>
    callCore('fileList', request),

  stat: (request: FileTargetRequest): Promise<FileResult<FileEntry>> =>
    callCore('fileStat', request),

  exists: (request: FileTargetRequest): Promise<FileResult<boolean>> =>
    callCore('fileExists', request),

  readText: (request: FileTargetRequest): Promise<FileResult<string>> =>
    callCore('fileReadText', request),

  mkdir: (request: FileMkdirRequest): Promise<FileResult<void>> => callCore('fileMkdir', request),

  createFile: (request: FileCreateRequest): Promise<FileResult<void>> =>
    callCore('fileCreateFile', request),

  writeText: (request: FileWriteTextRequest): Promise<FileResult<void>> =>
    callCore('fileWriteText', request),

  move: (request: FileMoveRequest): Promise<FileResult<void>> => callCore('fileMove', request),

  copy: (request: FileCopyRequest): Promise<FileResult<void>> => callCore('fileCopy', request),

  /** 递归删除在远端可能很慢，走长任务通道 */
  remove: (request: FileRemoveRequest): Promise<FileResult<void>> =>
    runJob('file.remove', request),

  upload: (request: FileUploadRequest): Promise<FileResult<FileTransferStart>> =>
    callCore('fileUpload', request),

  download: (request: FileDownloadRequest): Promise<FileResult<FileTransferStart>> =>
    callCore('fileDownload', request),

  cancelTransfer: (transferId: string): Promise<FileResult<boolean>> =>
    callCore('fileCancelTransfer', transferId),

  /** 订阅传输进度，返回取消订阅函数 */
  onTransferProgress: (listener: (event: FileTransferProgressEvent) => void): (() => void) =>
    subscribe(CORE_EVENTS.fileTransferProgress, listener),

  /** 订阅传输结束事件，返回取消订阅函数 */
  onTransferDone: (listener: (event: FileTransferDoneEvent) => void): (() => void) =>
    subscribe(CORE_EVENTS.fileTransferDone, listener)
}

export type FileApi = typeof fileApi
