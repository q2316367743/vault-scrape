import { ipcMain } from 'electron'
import { SettingChannels } from '~/modules/setting/settingChannels'
import type { SettingGroupKey } from '@common/types/setting'
import { loadSetting, saveSettingGroup } from './settingStore'

/** setting 域 IPC 注册 */
export function registerSettingIpc(): void {
  ipcMain.handle(SettingChannels.getAll, () => loadSetting())
  ipcMain.handle(SettingChannels.getGroup, (_event, key: SettingGroupKey) => loadSetting()[key])
  ipcMain.handle(SettingChannels.saveGroup, (_event, key: SettingGroupKey, value: unknown) =>
    saveSettingGroup(key, value)
  )
}
