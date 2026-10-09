/**
 * 影视墙 IPC 返回信封。
 *
 * 契约：实现内部抛 `MediaError`；跨 IPC 一律返回信封而不抛异常，
 * 因为 contextBridge 传递自定义错误的附加属性（如 code）并不可靠。
 */
import type { MediaErrorCode } from './error'

export type MediaResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: MediaErrorCode; message: string }

export function mediaOk<T>(data: T): MediaResult<T> {
  return { ok: true, data }
}

export function mediaFail(code: MediaErrorCode, message: string): MediaResult<never> {
  return { ok: false, code, message }
}

export function isMediaOk<T>(result: MediaResult<T>): result is { ok: true; data: T } {
  return result.ok
}
