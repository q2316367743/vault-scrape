/**
 * 插件 IPC 返回信封。
 *
 * 契约：实现内部抛 PluginError；跨 IPC 一律返回信封而不抛异常，
 * 因为 contextBridge 传递自定义错误的附加属性（如 code）并不可靠。
 */
import type { PluginErrorCode } from './error'

export type PluginResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: PluginErrorCode; message: string }

export function pluginOk<T>(data: T): PluginResult<T> {
  return { ok: true, data }
}

export function pluginFail(code: PluginErrorCode, message: string): PluginResult<never> {
  return { ok: false, code, message }
}

export function isPluginOk<T>(result: PluginResult<T>): result is { ok: true; data: T } {
  return result.ok
}
