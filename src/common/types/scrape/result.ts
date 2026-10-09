/**
 * 刮削 IPC 返回信封。
 *
 * 契约：实现内部抛 ScrapeError；跨 IPC 一律返回信封而不抛异常，
 * 因为 contextBridge 传递自定义错误的附加属性（如 code）并不可靠。
 */
import type { ScrapeErrorCode } from './error'

export type ScrapeResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ScrapeErrorCode; message: string }

export function scrapeOk<T>(data: T): ScrapeResult<T> {
  return { ok: true, data }
}

export function scrapeFail(code: ScrapeErrorCode, message: string): ScrapeResult<never> {
  return { ok: false, code, message }
}

export function isScrapeOk<T>(result: ScrapeResult<T>): result is { ok: true; data: T } {
  return result.ok
}
