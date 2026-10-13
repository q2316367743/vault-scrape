import { readBoolean, readEnum, readString, toSource } from './shared'

/** 目标语言 */
export type TranslateLanguage = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko'

export const TRANSLATE_LANGUAGES: readonly TranslateLanguage[] = [
  'zh-CN',
  'zh-TW',
  'en',
  'ja',
  'ko'
]

/**
 * 语言的中文名。
 *
 * 契约：设置页的目标语言下拉、详情页的「原文 / 译文」切换条、资料库的「内容语言」下拉
 * 共用这一份，界面上一律只出现这里的名字（不出现语言码）。
 */
export const TRANSLATE_LANGUAGE_LABELS: Readonly<Record<TranslateLanguage, string>> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어'
}

/** 翻译服务设置 */
export interface SettingTranslate {
  /** 是否启用：**只决定刮削完成后要不要自动翻译**，手动翻译不受它影响 */
  enabled: boolean
  /** 目标语言 */
  targetLanguage: TranslateLanguage
  /** 自动翻译使用的翻译插件 ID；空串表示按插件页顺序取第一个可用的 */
  pluginId: string
  /** 翻译完成后是否把译文写进磁盘 NFO（外部播放器与媒体服务器据此显示译文） */
  writeNfo: boolean
}

export function buildSettingTranslate(): SettingTranslate {
  return {
    enabled: false,
    targetLanguage: 'zh-CN',
    pluginId: '',
    writeNfo: true
  }
}

export function normalizeSettingTranslate(raw: unknown): SettingTranslate {
  const base = buildSettingTranslate()
  const source = toSource(raw)
  if (!source) return base
  return {
    enabled: readBoolean(source, 'enabled', base.enabled),
    targetLanguage: readEnum(source, 'targetLanguage', TRANSLATE_LANGUAGES, base.targetLanguage),
    pluginId: readString(source, 'pluginId', base.pluginId),
    writeNfo: readBoolean(source, 'writeNfo', base.writeNfo)
  }
}
