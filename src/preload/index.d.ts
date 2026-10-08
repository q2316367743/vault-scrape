import { ElectronAPI } from '@electron-toolkit/preload'
import type { AppWindowApi } from './src/modules/appWindow/appWindow'
import type { DbApi } from './src/modules/db/db'
import type { SettingApi } from './src/modules/setting/setting'

declare global {
  interface Window {
    electron: ElectronAPI
    preload: {
      appWindow: AppWindowApi
      db: DbApi
      setting: SettingApi
    }
  }
}
