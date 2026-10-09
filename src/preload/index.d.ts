import { ElectronAPI } from '@electron-toolkit/preload'
import type { AppWindowApi } from './src/modules/appWindow/appWindow'
import type { DbApi } from './src/modules/db/db'
import type { FileApi } from './src/modules/file/file'
import type { OfflineApi } from './src/modules/offline/offline'
import type { PluginApi } from './src/modules/plugin/plugin'
import type { SettingApi } from './src/modules/setting/setting'

declare global {
  interface Window {
    electron: ElectronAPI
    preload: {
      appWindow: AppWindowApi
      db: DbApi
      file: FileApi
      offline: OfflineApi
      plugin: PluginApi
      setting: SettingApi
    }
  }
}
