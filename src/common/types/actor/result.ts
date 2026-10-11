/**
 * 演员 IPC 返回信封。
 *
 * 契约：实现内部抛 `ActorError`；跨 IPC 一律返回信封而不抛异常，
 * 因为 contextBridge 传递自定义错误的附加属性（如 code）并不可靠。
 */
import type { ActorErrorCode } from './error'

export type ActorResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ActorErrorCode; message: string }

export function actorOk<T>(data: T): ActorResult<T> {
  return { ok: true, data }
}

export function actorFail(code: ActorErrorCode, message: string): ActorResult<never> {
  return { ok: false, code, message }
}

export function isActorOk<T>(result: ActorResult<T>): result is { ok: true; data: T } {
  return result.ok
}
