/**
 * 文件传输（上传 / 下载）的进度与结束事件。
 *
 * 契约：主进程 → 渲染层单向推送；事件按 transferId 关联，
 * 结束事件一定会到达（成功 ok: true，失败带错误码与中文文案）。
 */
import type { FileErrorCode } from './error'

export type FileTransferKind = 'upload' | 'download'

export interface FileTransferProgressEvent {
  transferId: string
  connectionId: string
  kind: FileTransferKind
  /** 连接内路径（上传为目标、下载为来源） */
  path: string
  transferred: number
  total: number
}

export type FileTransferDoneEvent =
  | {
      transferId: string
      connectionId: string
      kind: FileTransferKind
      path: string
      ok: true
    }
  | {
      transferId: string
      connectionId: string
      kind: FileTransferKind
      path: string
      ok: false
      code: FileErrorCode
      message: string
    }

/** 传输启动结果：立刻返回 transferId，便于随时取消 */
export interface FileTransferStart {
  transferId: string
}
