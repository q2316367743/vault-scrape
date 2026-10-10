import { normalizeSettingApp, buildSettingApp, type SettingApp } from './appSetting'
import { normalizeSettingDownload, buildSettingDownload, type SettingDownload } from './downloadSetting'
import { normalizeSettingFile, buildSettingFile, type SettingFile } from './fileSetting'
import {
  normalizeSettingLibrary,
  buildSettingLibrary,
  type SettingLibrary
} from './librarySetting'
import { normalizeSettingNaming, buildSettingNaming, type SettingNaming } from './namingSetting'
import { normalizeSettingNetwork, buildSettingNetwork, type SettingNetwork } from './networkSetting'
import { normalizeSettingScrape, buildSettingScrape, type SettingScrape } from './scrapeSetting'
import {
  normalizeSettingTranslate,
  buildSettingTranslate,
  type SettingTranslate
} from './translateSetting'

export type {
  SettingApp,
  SettingScrape,
  SettingNetwork,
  SettingTranslate,
  SettingNaming,
  SettingDownload,
  SettingFile,
  SettingLibrary
}

export {
  DEFAULT_LIBRARY_EXTENSIONS,
  LIBRARY_EXTENSION_LIMIT,
  libraryExtensionsOf,
  normalizeExtensionList
} from './librarySetting'

export { PROXY_TYPES, type ProxyType } from './networkSetting'
export { TRANSLATE_LANGUAGES, type TranslateLanguage } from './translateSetting'
export {
  ASSET_NAMINGS,
  PART_STYLES,
  type AssetNaming,
  type PartStyle
} from './namingSetting'
export { BADGE_CORNERS, type BadgeCorner } from './downloadSetting'

/**
 * 设置的完整形态：按功能域分组，落盘为单个 settings.json。
 * 账号设置（站点账号参数）尚未接入，故不在本类型内。
 */
export interface SettingSchema {
  app: SettingApp
  library: SettingLibrary
  scrape: SettingScrape
  network: SettingNetwork
  translate: SettingTranslate
  naming: SettingNaming
  download: SettingDownload
  file: SettingFile
}

export type SettingGroupKey = keyof SettingSchema

export const SETTING_GROUP_KEYS: readonly SettingGroupKey[] = [
  'app',
  'library',
  'scrape',
  'network',
  'translate',
  'naming',
  'download',
  'file'
]

/** 单组归一化器表：主进程保存单组时按 key 取用 */
export const settingNormalizers: {
  readonly [K in SettingGroupKey]: (raw: unknown) => SettingSchema[K]
} = {
  app: normalizeSettingApp,
  library: normalizeSettingLibrary,
  scrape: normalizeSettingScrape,
  network: normalizeSettingNetwork,
  translate: normalizeSettingTranslate,
  naming: normalizeSettingNaming,
  download: normalizeSettingDownload,
  file: normalizeSettingFile
}

export function buildSetting(): SettingSchema {
  return {
    app: buildSettingApp(),
    library: buildSettingLibrary(),
    scrape: buildSettingScrape(),
    network: buildSettingNetwork(),
    translate: buildSettingTranslate(),
    naming: buildSettingNaming(),
    download: buildSettingDownload(),
    file: buildSettingFile()
  }
}

/** 归一化整树：非对象整体回落默认值，逐组独立归一化 */
export function normalizeSetting(raw: unknown): SettingSchema {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return {
    app: settingNormalizers.app(source.app),
    library: settingNormalizers.library(source.library),
    scrape: settingNormalizers.scrape(source.scrape),
    network: settingNormalizers.network(source.network),
    translate: settingNormalizers.translate(source.translate),
    naming: settingNormalizers.naming(source.naming),
    download: settingNormalizers.download(source.download),
    file: settingNormalizers.file(source.file)
  }
}
