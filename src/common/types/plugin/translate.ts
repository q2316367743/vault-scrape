/**
 * 翻译插件契约：一段文本进、一段译文出。
 *
 * 契约：
 * - 入参是对象：`text` 与 `to` 必填，`from` 缺省表示「由站点自动识别源语言」；
 * - 语言码统一用宿主的 5 种（`TranslateLanguage`）——各站点的私有码（`zh` / `zt` 等）
 *   由插件在内部映射，宿主与调用方只认这一套；
 * - 返回值必须是 `{ text }`：宿主会再归一化一次，`text` 为空即 `invokeFailed`；
 * - 目标是「一段文本换一段译文」的纯函数式能力，不落盘、不产生资源。
 */
import { TRANSLATE_LANGUAGES, type TranslateLanguage } from '../setting/translateSetting'
import { readString, toSource } from '../setting/shared'

/** 宿主支持的语言码：插件内部把它映射成各站点的私有码 */
export const PLUGIN_TRANSLATE_LANGUAGES: readonly TranslateLanguage[] = TRANSLATE_LANGUAGES

/** 翻译入参 */
export interface PluginTranslateRequest {
  /** 待翻译文本 */
  text: string
  /** 源语言；缺省由站点自动识别 */
  from?: TranslateLanguage
  /** 目标语言 */
  to: TranslateLanguage
}

/** 翻译结果 */
export interface PluginTranslateResult {
  /** 译文 */
  text: string
}

export function isTranslateLanguage(value: unknown): value is TranslateLanguage {
  return PLUGIN_TRANSLATE_LANGUAGES.some((language) => language === value)
}

/** 归一化插件返回的译文；`text` 缺失或全是空白时返回 null，由调用方报 `invokeFailed` */
export function normalizeTranslateResult(raw: unknown): PluginTranslateResult | null {
  const source = toSource(raw)
  if (!source) return null
  const text = readString(source, 'text', '')
  return text.trim().length > 0 ? { text } : null
}
