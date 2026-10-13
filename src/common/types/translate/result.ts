/**
 * 翻译 IPC 返回信封与结果。
 *
 * 契约：实现内部抛 `TranslateError`；跨 IPC 一律返回信封而不抛异常，
 * 因为 contextBridge 传递自定义错误的附加属性（如 code）并不可靠。
 */
import type { TranslateLanguage } from '../setting/translateSetting'
import type { TranslateErrorCode } from './error'

export type TranslateResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: TranslateErrorCode; message: string }

export function translateOk<T>(data: T): TranslateResult<T> {
  return { ok: true, data }
}

export function translateFail(code: TranslateErrorCode, message: string): TranslateResult<never> {
  return { ok: false, code, message }
}

export function isTranslateOk<T>(result: TranslateResult<T>): result is { ok: true; data: T } {
  return result.ok
}

/** 一次条目翻译的结果：条目 → 译文语言与「翻了多少」 */
export interface TranslateItemResult {
  itemId: string
  /** 本次译文使用的语言 */
  language: TranslateLanguage
  /** 真正写进库的字段数（译文与原文相同的不计入） */
  translatedCount: number
  /** 有原文、值得翻译的字段数；为 0 表示这个条目没有可翻译的内容 */
  total: number
}

/** 丢弃译文的结果 */
export interface TranslateClearResult {
  itemId: string
  /** 是否真的删掉了一行译文 */
  removed: boolean
}
