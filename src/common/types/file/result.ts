/**
 * IPC 返回信封。
 *
 * 契约：实现类在 main 内部抛 FileError；跨 IPC 一律返回信封而不抛异常，
 * 因为 contextBridge 传递自定义错误的附加属性（如 code）并不可靠。
 */
import type { FileErrorCode } from './error'

export type FileResult<T> = { ok: true; data: T } | { ok: false; code: FileErrorCode; message: string }

export interface ConnectionTestResult {
  ok: boolean
  /** 中文提示，成功为「连接成功」，失败为具体原因 */
  message: string
}

export function fileOk<T>(data: T): FileResult<T> {
  return { ok: true, data }
}

export function fileFail(code: FileErrorCode, message: string): FileResult<never> {
  return { ok: false, code, message }
}

export function isFileOk<T>(result: FileResult<T>): result is { ok: true; data: T } {
  return result.ok
}
