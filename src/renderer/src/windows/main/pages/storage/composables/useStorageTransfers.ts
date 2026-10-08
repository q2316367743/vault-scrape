/**
 * 存储管理页的传输队列：上传 / 下载的进度与结束事件。
 *
 * 契约：upload / download 立即返回 transferId，进度与结束靠主进程推送；
 * 只跟踪本页发起的传输（按 transferId 白名单），不响应其它页面发起的任务。
 */
import { onScopeDispose, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { fileApi } from '@/api'
import type {
  FileDownloadRequest,
  FileResult,
  FileTransferDoneEvent,
  FileTransferKind,
  FileTransferProgressEvent,
  FileTransferStart,
  FileUploadRequest
} from '@common/types/file'

export type StorageTransferStatus = 'running' | 'done' | 'failed'

export interface StorageTransferItem {
  transferId: string
  connectionId: string
  kind: FileTransferKind
  /** 连接内路径：上传为目标、下载为来源 */
  path: string
  transferred: number
  total: number
  status: StorageTransferStatus
  message: string
}

export interface StorageTransferOptions {
  /** 传输结束时回调，供页面刷新当前目录 */
  onSettled?: (event: FileTransferDoneEvent) => void
}

export function useStorageTransfers(options: StorageTransferOptions = {}) {
  const items = ref<StorageTransferItem[]>([])
  const tracked = new Set<string>()

  function handleProgress(event: FileTransferProgressEvent): void {
    if (!tracked.has(event.transferId)) return
    const item = items.value.find((entry) => entry.transferId === event.transferId)
    if (!item) return
    item.transferred = event.transferred
    item.total = event.total
  }

  function handleDone(event: FileTransferDoneEvent): void {
    if (!tracked.has(event.transferId)) return
    tracked.delete(event.transferId)
    const item = items.value.find((entry) => entry.transferId === event.transferId)
    if (item) {
      item.status = event.ok ? 'done' : 'failed'
      item.message = event.ok ? '已完成' : event.message
      if (event.ok) item.transferred = item.total
    }
    options.onSettled?.(event)
  }

  const disposeProgress = fileApi.onTransferProgress(handleProgress)
  const disposeDone = fileApi.onTransferDone(handleDone)

  onScopeDispose(() => {
    disposeProgress()
    disposeDone()
  })

  function register(
    result: FileResult<FileTransferStart>,
    kind: FileTransferKind,
    connectionId: string,
    path: string
  ): void {
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return
    }
    tracked.add(result.data.transferId)
    items.value.push({
      transferId: result.data.transferId,
      connectionId,
      kind,
      path,
      transferred: 0,
      total: 0,
      status: 'running',
      message: '等待中'
    })
  }

  async function upload(request: FileUploadRequest): Promise<void> {
    const result = await fileApi.upload(request)
    register(result, 'upload', request.connectionId, request.remotePath)
  }

  async function download(request: FileDownloadRequest): Promise<void> {
    const result = await fileApi.download(request)
    register(result, 'download', request.connectionId, request.remotePath)
  }

  async function cancel(transferId: string): Promise<void> {
    const result = await fileApi.cancelTransfer(transferId)
    if (!result.ok) MessagePlugin.error(result.message)
  }

  function clearFinished(): void {
    items.value = items.value.filter((item) => item.status === 'running')
  }

  return { items, upload, download, cancel, clearFinished }
}
