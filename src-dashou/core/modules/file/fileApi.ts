/**
 * 文件域的 core API。
 *
 * 契约：
 * 1. 实现类在 core 内部抛 FileError，**只有 API 边界做信封转换**；
 * 2. 读类操作（list / stat / exists / readText）按设置的 retryCount 重试，写类操作不重试；
 * 3. upload / download 立即返回 transferId，进度与结果通过事件回推。
 */
import {
  FileError,
  describeFileError,
  fileFail,
  fileOk,
  type ConnectionTestResult,
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
import { deleteLibrariesByConnection } from '$/modules/library/libraryStore'
import type { FileClient } from './FileClient'
import { isRetryableFileError } from './fileErrorUtils'
import { deleteConnection, listConnections, saveConnection } from './fileConnectionStore'
import { getFileClient, invalidateFileClient, testFileConnection } from './fileClientManager'
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

/** 删除连接 / 取消传输这类「只传一个字符串」的调用：非字符串一律当空值 */
function idStringOf(payload: unknown): string {
  return typeof payload === 'string' ? payload : ''
}

export const fileApi = {
  fileListConnections: (): Promise<FileResult<FileConnection[]>> =>
    handle(async (): Promise<FileConnection[]> => listConnections()),

  fileSaveConnection: (_ctx: unknown, draft: unknown): Promise<FileResult<FileConnection>> =>
    handle(async (): Promise<FileConnection> => {
      const connection = saveConnection(draft as FileConnectionDraft)
      await invalidateFileClient(connection.id)
      return connection
    }),

  fileDeleteConnection: (_ctx: unknown, payload: unknown): Promise<FileResult<boolean>> =>
    handle(async (): Promise<boolean> => {
      const connectionId = idStringOf(payload)
      const removed = deleteConnection(connectionId)
      await invalidateFileClient(connectionId)
      // 存储没了，媒体条目与图片就成了悬空数据，资料库配置也一并清掉
      deleteLibrariesByConnection(connectionId)
      return removed
    }),

  fileTestConnection: (_ctx: unknown, draft: unknown): Promise<FileResult<ConnectionTestResult>> =>
    handle(() => testFileConnection(draft as FileConnectionDraft)),

  fileDisposeConnection: (_ctx: unknown, payload: unknown): Promise<FileResult<boolean>> =>
    handle(async (): Promise<boolean> => {
      await invalidateFileClient(idStringOf(payload))
      return true
    }),

  fileList: (_ctx: unknown, request: unknown): Promise<FileResult<unknown>> =>
    handle(() => {
      const target = request as FileTargetRequest
      return withClient(target.connectionId, (client) => client.list(target.path), true)
    }),

  fileStat: (_ctx: unknown, request: unknown): Promise<FileResult<unknown>> =>
    handle(() => {
      const target = request as FileTargetRequest
      return withClient(target.connectionId, (client) => client.stat(target.path), true)
    }),

  fileExists: (_ctx: unknown, request: unknown): Promise<FileResult<boolean>> =>
    handle(() => {
      const target = request as FileTargetRequest
      return withClient(target.connectionId, (client) => client.exists(target.path), true)
    }),

  fileReadText: (_ctx: unknown, request: unknown): Promise<FileResult<string>> =>
    handle(() => {
      const target = request as FileTargetRequest
      return withClient(target.connectionId, (client) => client.readText(target.path), true)
    }),

  fileMkdir: (_ctx: unknown, request: unknown): Promise<FileResult<void>> =>
    handle(() => {
      const payload = request as FileMkdirRequest
      return withClient(
        payload.connectionId,
        (client) => client.mkdir(payload.path, { recursive: payload.recursive }),
        false
      )
    }),

  fileCreateFile: (_ctx: unknown, request: unknown): Promise<FileResult<void>> =>
    handle(() => {
      const payload = request as FileCreateRequest
      return withClient(
        payload.connectionId,
        (client) => client.createFile(payload.path, { overwrite: payload.overwrite }),
        false
      )
    }),

  fileWriteText: (_ctx: unknown, request: unknown): Promise<FileResult<void>> =>
    handle(() => {
      const payload = request as FileWriteTextRequest
      return withClient(
        payload.connectionId,
        (client) => client.writeText(payload.path, payload.content, { overwrite: payload.overwrite }),
        false
      )
    }),

  fileMove: (_ctx: unknown, request: unknown): Promise<FileResult<void>> =>
    handle(() => {
      const payload = request as FileMoveRequest
      return withClient(
        payload.connectionId,
        (client) => client.move(payload.from, payload.to, { overwrite: payload.overwrite }),
        false
      )
    }),

  fileCopy: (_ctx: unknown, request: unknown): Promise<FileResult<void>> =>
    handle(() => {
      const payload = request as FileCopyRequest
      return withClient(
        payload.connectionId,
        (client) => client.copy(payload.from, payload.to, { overwrite: payload.overwrite }),
        false
      )
    }),

  fileRemove: (_ctx: unknown, request: unknown): Promise<FileResult<void>> =>
    handle(() => {
      const payload = request as FileRemoveRequest
      return withClient(
        payload.connectionId,
        (client) => client.remove(payload.path, { recursive: payload.recursive }),
        false
      )
    }),

  fileUpload: (_ctx: unknown, request: unknown): Promise<FileResult<FileTransferStart>> =>
    handle(async (): Promise<FileTransferStart> => {
      const payload = request as FileUploadRequest
      const client = await getFileClient(payload.connectionId)
      return startTransfer({
        connectionId: payload.connectionId,
        kind: 'upload',
        path: payload.remotePath,
        run: ({ onProgress, signal }) =>
          client.upload(payload.localPath, payload.remotePath, {
            overwrite: payload.overwrite,
            onProgress,
            signal
          })
      })
    }),

  fileDownload: (_ctx: unknown, request: unknown): Promise<FileResult<FileTransferStart>> =>
    handle(async (): Promise<FileTransferStart> => {
      const payload = request as FileDownloadRequest
      const client = await getFileClient(payload.connectionId)
      return startTransfer({
        connectionId: payload.connectionId,
        kind: 'download',
        path: payload.remotePath,
        run: ({ onProgress, signal }) =>
          client.download(payload.remotePath, payload.localPath, {
            overwrite: payload.overwrite,
            onProgress,
            signal
          })
      })
    }),

  fileCancelTransfer: (_ctx: unknown, payload: unknown): Promise<FileResult<boolean>> =>
    handle(async (): Promise<boolean> => cancelTransfer(idStringOf(payload)))
}
