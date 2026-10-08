/**
 * 上传 / 下载的登记表：负责 transferId、取消与「主进程 → 渲染层」的进度推送。
 *
 * 契约：
 * 1. upload / download 立即返回 transferId，不等待传输完成；
 * 2. 结束事件一定会推送一次（成功 ok: true，失败带错误码与中文文案）；
 * 3. 渲染层已销毁时静默丢弃事件，不做任何等待。
 */
import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import {
  describeFileError,
  type FileTransferDoneEvent,
  type FileTransferKind,
  type FileTransferProgressEvent
} from '@common/types/file'
import { FileChannels } from '~/modules/file/fileChannels'

export interface TransferRunContext {
  onProgress: (transferred: number, total: number) => void
  signal: AbortSignal
}

export interface TransferStartOptions {
  connectionId: string
  kind: FileTransferKind
  /** 连接内路径（上传为目标、下载为来源） */
  path: string
  /** 发起 invoke 的渲染进程，用于回推进度 */
  sender: WebContents
  run: (context: TransferRunContext) => Promise<void>
}

const transfers = new Map<string, AbortController>()

export function startTransfer(options: TransferStartOptions): { transferId: string } {
  const transferId = randomUUID()
  const controller = new AbortController()
  const { connectionId, kind, path, sender } = options
  transfers.set(transferId, controller)

  const sendProgress = (transferred: number, total: number): void => {
    if (sender.isDestroyed()) return
    const payload: FileTransferProgressEvent = {
      transferId,
      connectionId,
      kind,
      path,
      transferred,
      total
    }
    sender.send(FileChannels.transferProgress, payload)
  }

  const finish = (error: unknown): void => {
    transfers.delete(transferId)
    if (sender.isDestroyed()) return
    const payload: FileTransferDoneEvent =
      error === null
        ? { transferId, connectionId, kind, path, ok: true }
        : { transferId, connectionId, kind, path, ok: false, ...describeFileError(error) }
    sender.send(FileChannels.transferDone, payload)
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
