/**
 * 文件模块的 IPC 注册。
 *
 * 契约：
 * 1. 实现类在 main 内部抛 FileError，**只有 IPC 边界做信封转换**；
 * 2. 读类操作（list / stat / exists / readText）按设置的 retryCount 重试，写类操作不重试（保证非幂等语义）；
 * 3. upload / download 立即返回 transferId，进度与结果通过 push 通道回推。
 */
import { ipcMain } from 'electron'
import {
  FileError,
  describeFileError,
  fileFail,
  fileOk,
  type FileConnection,
  type FileConnectionDraft,
  type FileCopyRequest,
  type FileCreateRequest,
  type FileDownloadRequest,
  type FileMkdirRequest,
  type FileMoveRequest,
  type FileRemoveRequest,
  type FileResult,
  type FileTargetRequest,
  type FileTransferStart,
  type FileUploadRequest,
  type FileWriteTextRequest
} from '@common/types/file'
import { FileChannels } from '~/modules/file/fileChannels'
import { deleteResourceByConnection } from '$/db/repo/resourceRepo'
import type { FileClient } from './FileClient'
import { isRetryableFileError } from './fileErrorUtils'
import {
  deleteConnection,
  listConnections,
  saveConnection
} from './fileConnectionStore'
import {
  getFileClient,
  invalidateFileClient,
  testFileConnection
} from './fileClientManager'
import { cancelTransfer, startTransfer } from './fileTransferRegistry'
import { loadSetting } from '../setting/settingStore'

const RETRY_DELAY_MS = 300

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function handle<T>(task: () => Promise<T>): Promise<FileResult<T>> {
  try {
    return fileOk(await task())
  } catch (error) {
    const { code, message } = describeFileError(error)
    return fileFail(code, message)
  }
}

/** 读类操作的失败重试：只重试 network / timeout */
async function runWithRetry<T>(task: () => Promise<T>): Promise<T> {
  const retryCount = Math.max(0, Math.floor(loadSetting().network.retryCount))
  let lastError: unknown = new FileError('unknown', '读取失败')
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      if (!isRetryableFileError(error) || attempt === retryCount) break
    }
    await delay(RETRY_DELAY_MS)
  }
  throw lastError
}

async function withClient<T>(
  connectionId: string,
  task: (client: FileClient) => Promise<T>,
  retry: boolean
): Promise<T> {
  const attempt = async (): Promise<T> => task(await getFileClient(connectionId))
  return retry ? runWithRetry(attempt) : attempt()
}

export function registerFileIpc(): void {
  ipcMain.handle(FileChannels.listConnections, () =>
    handle(async (): Promise<FileConnection[]> => listConnections())
  )

  ipcMain.handle(FileChannels.saveConnection, (_event, draft: FileConnectionDraft) =>
    handle(async (): Promise<FileConnection> => {
      const connection = saveConnection(draft)
      await invalidateFileClient(connection.id)
      return connection
    })
  )

  ipcMain.handle(FileChannels.deleteConnection, (_event, connectionId: string) =>
    handle(async (): Promise<boolean> => {
      const removed = deleteConnection(connectionId)
      await invalidateFileClient(connectionId)
      // 存储没了，索引里的资源 ID 就成了悬空数据，一并清掉
      deleteResourceByConnection(connectionId)
      return removed
    })
  )

  ipcMain.handle(FileChannels.testConnection, (_event, draft: FileConnectionDraft) =>
    handle(() => testFileConnection(draft))
  )

  ipcMain.handle(FileChannels.disposeConnection, (_event, connectionId: string) =>
    handle(async (): Promise<boolean> => {
      await invalidateFileClient(connectionId)
      return true
    })
  )

  ipcMain.handle(FileChannels.list, (_event, request: FileTargetRequest) =>
    handle(() => withClient(request.connectionId, (client) => client.list(request.path), true))
  )

  ipcMain.handle(FileChannels.stat, (_event, request: FileTargetRequest) =>
    handle(() => withClient(request.connectionId, (client) => client.stat(request.path), true))
  )

  ipcMain.handle(FileChannels.exists, (_event, request: FileTargetRequest) =>
    handle(() => withClient(request.connectionId, (client) => client.exists(request.path), true))
  )

  ipcMain.handle(FileChannels.readText, (_event, request: FileTargetRequest) =>
    handle(() => withClient(request.connectionId, (client) => client.readText(request.path), true))
  )

  ipcMain.handle(FileChannels.mkdir, (_event, request: FileMkdirRequest) =>
    handle(() =>
      withClient(
        request.connectionId,
        (client) => client.mkdir(request.path, { recursive: request.recursive }),
        false
      )
    )
  )

  ipcMain.handle(FileChannels.createFile, (_event, request: FileCreateRequest) =>
    handle(() =>
      withClient(
        request.connectionId,
        (client) => client.createFile(request.path, { overwrite: request.overwrite }),
        false
      )
    )
  )

  ipcMain.handle(FileChannels.writeText, (_event, request: FileWriteTextRequest) =>
    handle(() =>
      withClient(
        request.connectionId,
        (client) =>
          client.writeText(request.path, request.content, { overwrite: request.overwrite }),
        false
      )
    )
  )

  ipcMain.handle(FileChannels.move, (_event, request: FileMoveRequest) =>
    handle(() =>
      withClient(
        request.connectionId,
        (client) => client.move(request.from, request.to, { overwrite: request.overwrite }),
        false
      )
    )
  )

  ipcMain.handle(FileChannels.copy, (_event, request: FileCopyRequest) =>
    handle(() =>
      withClient(
        request.connectionId,
        (client) => client.copy(request.from, request.to, { overwrite: request.overwrite }),
        false
      )
    )
  )

  ipcMain.handle(FileChannels.remove, (_event, request: FileRemoveRequest) =>
    handle(() =>
      withClient(
        request.connectionId,
        (client) => client.remove(request.path, { recursive: request.recursive }),
        false
      )
    )
  )

  ipcMain.handle(FileChannels.upload, (event, request: FileUploadRequest) =>
    handle(async (): Promise<FileTransferStart> => {
      const client = await getFileClient(request.connectionId)
      return startTransfer({
        connectionId: request.connectionId,
        kind: 'upload',
        path: request.remotePath,
        sender: event.sender,
        run: ({ onProgress, signal }) =>
          client.upload(request.localPath, request.remotePath, {
            overwrite: request.overwrite,
            onProgress,
            signal
          })
      })
    })
  )

  ipcMain.handle(FileChannels.download, (event, request: FileDownloadRequest) =>
    handle(async (): Promise<FileTransferStart> => {
      const client = await getFileClient(request.connectionId)
      return startTransfer({
        connectionId: request.connectionId,
        kind: 'download',
        path: request.remotePath,
        sender: event.sender,
        run: ({ onProgress, signal }) =>
          client.download(request.remotePath, request.localPath, {
            overwrite: request.overwrite,
            onProgress,
            signal
          })
      })
    })
  )

  ipcMain.handle(FileChannels.cancelTransfer, (_event, transferId: string) =>
    handle(async (): Promise<boolean> => cancelTransfer(transferId))
  )
}
