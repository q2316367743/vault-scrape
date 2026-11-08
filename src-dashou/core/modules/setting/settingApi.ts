/**
 * 设置域的 core API：按分组读写，整树落盘由 core 负责。
 */
import { SETTING_GROUP_KEYS, type SettingGroupKey, type SettingSchema } from '@common/types/setting'
import { loadSetting, saveSettingGroup } from './settingStore'

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
  }
}
