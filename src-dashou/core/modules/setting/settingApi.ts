/**
 * 设置域的 core API：按分组读写，整树落盘由 core 负责。
 */
import { SETTING_GROUP_KEYS, type SettingGroupKey, type SettingSchema } from '@common/types/setting'
import { loadSetting, saveSettingGroup } from './settingStore'
import { loadUiPrefs, saveUiPref } from './uiPrefsStore'

function readKey(value: unknown): SettingGroupKey {
  const key = typeof value === 'string' ? value : ''
  const matched = SETTING_GROUP_KEYS.find((item) => item === key)
  if (!matched) throw new Error('未知的设置分组')
  return matched
}

export const settingApi = {
  settingGetAll: (): SettingSchema => loadSetting(),

  settingGetGroup: (_ctx: unknown, payload: unknown): unknown => {
    const source = payload as { key?: unknown } | undefined
    return loadSetting()[readKey(source?.key)]
  },

  settingSaveGroup: (_ctx: unknown, payload: unknown): SettingSchema => {
    const source = payload as { key?: unknown; value?: unknown } | undefined
    const key = readKey(source?.key)
    return saveSettingGroup(key, source?.value)
  },

  /** 窗口 UI 偏好：整树读 + 单键写（异步落盘，避免频繁写入阻塞） */
  uiPrefsGetAll: (): Record<string, unknown> => loadUiPrefs(),

  uiPrefsSet: (_ctx: unknown, payload: unknown): void => {
    const source = payload as { key?: unknown; value?: unknown } | undefined
    if (typeof source?.key !== 'string') throw new Error('偏好项名称不合法')
    saveUiPref(source.key, source?.value)
  }
}
