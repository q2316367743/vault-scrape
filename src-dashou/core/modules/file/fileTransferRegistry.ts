/**
 * 上传 / 下载的登记表：负责 transferId、取消与「core → 窗口」的进度推送。
 *
 * 契约：
 * 1. upload / download 立即返回 transferId，不等待传输完成；
 * 2. 结束事件一定会推送一次（成功 ok: true，失败带错误码与中文文案）；
 * 3. 事件广播给所有窗口，由发起方按 transferId 过滤；窗口不在时宿主静默丢弃。
 */
import { randomUUID } from 'node:crypto'
import {
  describeFileError,
  type FileTransferDoneEvent,
  type FileTransferKind,
  type FileTransferProgressEvent
} from '@common/types/file'
import { CORE_EVENTS } from '@common/channels'
import { emit } from '../../runtime/host'

export interface TransferRunContext {
  onProgress: (transferred: number, total: number) => void
  signal: AbortSignal
}

export interface TransferStartOptions {
  connectionId: string
  kind: FileTransferKind
  /** 连接内路径（上传为目标、下载为来源） */
  path: string
  run: (context: TransferRunContext) => Promise<void>
}

const transfers = new Map<string, AbortController>()

export function startTransfer(options: TransferStartOptions): { transferId: string } {
  const transferId = randomUUID()
  const controller = new AbortController()
  const { connectionId, kind, path } = options
  transfers.set(transferId, controller)

  const sendProgress = (transferred: number, total: number): void => {
    const payload: FileTransferProgressEvent = {
      transferId,
      connectionId,
      kind,
      path,
      transferred,
      total
    }
    emit(CORE_EVENTS.fileTransferProgress, payload)
  }

  const finish = (error: unknown): void => {
    transfers.delete(transferId)
    const payload: FileTransferDoneEvent =
      error === null
        ? { transferId, connectionId, kind, path, ok: true }
        : { transferId, connectionId, kind, path, ok: false, ...describeFileError(error) }
    emit(CORE_EVENTS.fileTransferDone, payload)
  }

  void options.run({ onProgress: sendProgress, signal: controller.signal }).then(
    () => finish(null),
    (error: unknown) => finish(error)
  )

  return { transferId }
}

/** 取消进行中的传输；返回 false 表示 transferId 已结束或不存在 */
export function cancelTransfer(transferId: string): boolean {
  const controller = transfers.get(transferId)
  if (!controller) return false
  controller.abort()
  return true
}
