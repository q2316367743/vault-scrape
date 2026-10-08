import { ipcRenderer } from 'electron'
import type { SettingGroupKey, SettingSchema } from '@common/types/setting'
import { SettingChannels } from './settingChannels'

/** 渲染层读写设置的唯一入口：按分组读写，整树落盘由主进程负责 */
export const settingApi = {
  getAll: (): Promise<SettingSchema> => ipcRenderer.invoke(SettingChannels.getAll),
  getGroup: <K extends SettingGroupKey>(key: K): Promise<SettingSchema[K]> =>
    ipcRenderer.invoke(SettingChannels.getGroup, key),
  saveGroup: <K extends SettingGroupKey>(
    key: K,
    value: SettingSchema[K]
  ): Promise<SettingSchema> => ipcRenderer.invoke(SettingChannels.saveGroup, key, value)
}

export type SettingApi = typeof settingApi
