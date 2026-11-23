/**
 * 窗口 UI 偏好的持久化：侧栏折叠、主题选择、各页选中项等。
 *
 * 契约：
 * - 落盘位置 `<插件配置目录>/ui-prefs.json`，与业务设置文件相互独立；
 * - 只存 UI 偏好（可从零重建的界面状态），业务配置仍走 settingStore；
 * - 读失败回落空对象，绝不因为偏好损坏阻塞启动；
 * - key 限定格式，避免写坏文件结构。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { configPath } from '../../runtime/paths'

const PREF_KEY_PATTERN = /^[a-z][a-z0-9:-]{0,63}$/
let cache: Record<string, unknown> | null = null

function prefsFilePath(): string {
  return configPath('ui-prefs.json')
}

function readFromDisk(): Record<string, unknown> {
  const file = prefsFilePath()
  if (!existsSync(file)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf-8'))
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // 偏好文件损坏时忽略，用空对象
  }
  return {}
}

/** 全量读取（带内存缓存） */
export function loadUiPrefs(): Record<string, unknown> {
  if (!cache) cache = readFromDisk()
  return cache
}

/** 写入单个偏好；key 不合法时抛错，由 API 边界转成错误信封 */
export function saveUiPref(key: string, value: unknown): void {
  if (!PREF_KEY_PATTERN.test(key)) throw new Error('偏好项名称不合法')
  const next: Record<string, unknown> = { ...loadUiPrefs(), [key]: value }
  const file = prefsFilePath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf-8')
  cache = next
}
