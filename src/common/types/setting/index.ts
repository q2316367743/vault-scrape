import { normalizeSettingApp, buildSettingApp, type SettingApp } from './appSetting'
import { normalizeSettingDownload, buildSettingDownload, type SettingDownload } from './downloadSetting'
import { normalizeSettingFile, buildSettingFile, type SettingFile } from './fileSetting'
import { normalizeSettingNaming, buildSettingNaming, type SettingNaming } from './namingSetting'
import { normalizeSettingNetwork, buildSettingNetwork, type SettingNetwork } from './networkSetting'
import { normalizeSettingPath, buildSettingPath, type SettingPath } from './pathSetting'
import { normalizeSettingScrape, buildSettingScrape, type SettingScrape } from './scrapeSetting'
import {
  normalizeSettingTranslate,
  buildSettingTranslate,
  type SettingTranslate
} from './translateSetting'

export type {
  SettingApp,
  SettingPath,
  SettingScrape,
  SettingNetwork,
  SettingTranslate,
  SettingNaming,
  SettingDownload,
  SettingFile
}

export { PROXY_TYPES, type ProxyType } from './networkSetting'
export { TRANSLATE_LANGUAGES, type TranslateLanguage } from './translateSetting'
export {
  ASSET_NAMINGS,
  PART_STYLES,
  type AssetNaming,
  type PartStyle
} from './namingSetting'
export {
  BADGE_CORNERS,
  NFO_FILE_NAMINGS,
  type BadgeCorner,
  type NfoFileNaming
} from './downloadSetting'

/**
 * 设置的完整形态：按功能域分组，落盘为单个 settings.json。
 * 账号设置（站点账号参数）尚未接入，故不在本类型内。
 */
export interface SettingSchema {
  app: SettingApp
  path: SettingPath
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
  'path',
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
  path: normalizeSettingPath,
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
    path: buildSettingPath(),
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
    path: settingNormalizers.path(source.path),
    scrape: settingNormalizers.scrape(source.scrape),
    network: settingNormalizers.network(source.network),
    translate: settingNormalizers.translate(source.translate),
    naming: settingNormalizers.naming(source.naming),
    download: settingNormalizers.download(source.download),
    file: settingNormalizers.file(source.file)
  }
}
