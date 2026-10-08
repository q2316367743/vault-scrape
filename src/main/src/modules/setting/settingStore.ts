import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { app } from 'electron'
import {
  buildSetting,
  normalizeSetting,
  settingNormalizers,
  type SettingGroupKey,
  type SettingSchema
} from '@common/types/setting'

/**
 * main 是设置的数据家：内存缓存 + 写时刷新。
 *
 * - saveSettingGroup 是唯一写入口，先归一化、再落盘、最后刷新缓存；
 * - 读操作命中缓存后零磁盘 IO；
 * - 应用外手工修改文件不被感知（契约内不支持）；
 * - 归一化契约在 @common/types/setting/*，本文件只负责持久化与缓存。
 */
let cache: SettingSchema | null = null

function settingFilePath(): string {
  return join(app.getPath('home'), '.vault-scrape', 'setting', 'settings.json')
}

function readFromDisk(): SettingSchema {
  const file = settingFilePath()
  if (!existsSync(file)) return buildSetting()
  try {
    return normalizeSetting(JSON.parse(readFileSync(file, 'utf-8')))
  } catch (error) {
    console.error('[setting] 设置读取失败，使用默认配置', error)
    return buildSetting()
  }
}

export function loadSetting(): SettingSchema {
  if (!cache) cache = readFromDisk()
  return cache
}

export function saveSettingGroup<K extends SettingGroupKey>(key: K, value: unknown): SettingSchema {
  const next: SettingSchema = { ...loadSetting() }
  next[key] = settingNormalizers[key](value)
  const file = settingFilePath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(next, null, 2), 'utf-8')
  cache = next
  return next
}
