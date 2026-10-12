import { ipcMain } from 'electron'
import { SettingChannels } from '~/modules/setting/settingChannels'
import type { SettingGroupKey } from '@common/types/setting'
import { closePlayerWindow } from '$/modules/player/playerWindow'
import { loadSetting, saveSettingGroup } from './settingStore'

/** setting 域 IPC 注册 */
export function registerSettingIpc(): void {
  ipcMain.handle(SettingChannels.getAll, () => loadSetting())
  ipcMain.handle(SettingChannels.getGroup, (_event, key: SettingGroupKey) => loadSetting()[key])
  ipcMain.handle(SettingChannels.saveGroup, (_event, key: SettingGroupKey, value: unknown) => {
    const before = loadSetting()
    const next = saveSettingGroup(key, value)
    // 播放窗口的窗口形态（要不要透明挖洞、控制条要不要让一行）在开窗那一刻就定死了，只有重建才会变。
    // 少了这一步，「本来不用 mpv」改成「用 mpv」时窗口还是不透明的，mpv 画面被自己这层挡住——表现为只有声音。
    if (
      key === 'app' &&
      (before.app.mpvEnabled !== next.app.mpvEnabled || before.app.macEmbed !== next.app.macEmbed)
    ) {
      closePlayerWindow()
    }
    return next
  })
}
