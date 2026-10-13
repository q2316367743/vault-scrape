import { ElectronAPI } from '@electron-toolkit/preload'
import type { ActorApi } from './src/modules/actor/actor'
import type { AppWindowApi } from './src/modules/appWindow/appWindow'
import type { DbApi } from './src/modules/db/db'
import type { DialogApi } from './src/modules/dialog/dialog'
import type { FileApi } from './src/modules/file/file'
import type { LibraryApi } from './src/modules/library/library'
import type { MediaApi } from './src/modules/media/media'
import type { OfflineApi } from './src/modules/offline/offline'
import type { PlayerApi } from './src/modules/player/player'
import type { PluginApi } from './src/modules/plugin/plugin'
import type { ScrapeApi } from './src/modules/scrape/scrape'
import type { SettingApi } from './src/modules/setting/setting'
import type { TranslateApi } from './src/modules/translate/translate'

declare global {
  interface Window {
    electron: ElectronAPI
    preload: {
      actor: ActorApi
      appWindow: AppWindowApi
      db: DbApi
      dialog: DialogApi
      file: FileApi
      library: LibraryApi
      media: MediaApi
      offline: OfflineApi
      player: PlayerApi
      plugin: PluginApi
      scrape: ScrapeApi
      setting: SettingApi
      translate: TranslateApi
    }
  }
}
