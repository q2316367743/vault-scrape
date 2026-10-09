import { ElectronAPI } from '@electron-toolkit/preload'
import type { AppWindowApi } from './src/modules/appWindow/appWindow'
import type { DbApi } from './src/modules/db/db'
import type { DialogApi } from './src/modules/dialog/dialog'
import type { FileApi } from './src/modules/file/file'
import type { MediaApi } from './src/modules/media/media'
import type { OfflineApi } from './src/modules/offline/offline'
import type { PluginApi } from './src/modules/plugin/plugin'
import type { ScrapeApi } from './src/modules/scrape/scrape'
import type { SettingApi } from './src/modules/setting/setting'

declare global {
  interface Window {
    electron: ElectronAPI
    preload: {
      appWindow: AppWindowApi
      db: DbApi
      dialog: DialogApi
      file: FileApi
      media: MediaApi
      offline: OfflineApi
      plugin: PluginApi
      scrape: ScrapeApi
      setting: SettingApi
    }
  }
}
