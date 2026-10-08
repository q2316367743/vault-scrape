import { readBoolean, readEnum, toSource } from './shared'

/** 目标语言 */
export type TranslateLanguage = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko'

export const TRANSLATE_LANGUAGES: readonly TranslateLanguage[] = [
  'zh-CN',
  'zh-TW',
  'en',
  'ja',
  'ko'
]

/** 翻译服务设置 */
export interface SettingTranslate {
  /** 是否启用 */
  enabled: boolean
  /** 目标语言 */
  targetLanguage: TranslateLanguage
}

export function buildSettingTranslate(): SettingTranslate {
  return {
    enabled: false,
    targetLanguage: 'zh-CN'
  }
}

export function normalizeSettingTranslate(raw: unknown): SettingTranslate {
  const base = buildSettingTranslate()
  const source = toSource(raw)
  if (!source) return base
  return {
    enabled: readBoolean(source, 'enabled', base.enabled),
    targetLanguage: readEnum(source, 'targetLanguage', TRANSLATE_LANGUAGES, base.targetLanguage)
  }
}
