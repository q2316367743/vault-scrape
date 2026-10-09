import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { appWindowApi } from '~/modules/appWindow/appWindow'
import { dbApi } from '~/modules/db/db'
import { dialogApi } from '~/modules/dialog/dialog'
import { fileApi } from '~/modules/file/file'
import { mediaApi } from '~/modules/media/media'
import { offlineApi } from '~/modules/offline/offline'
import { pluginApi } from '~/modules/plugin/plugin'
import { scrapeApi } from '~/modules/scrape/scrape'
import { settingApi } from '~/modules/setting/setting'

// 业务桥：渲染层只通过这些 API 访问主进程能力
const preload = {
  appWindow: appWindowApi,
  db: dbApi,
  dialog: dialogApi,
  file: fileApi,
  media: mediaApi,
  offline: offlineApi,
  plugin: pluginApi,
  scrape: scrapeApi,
  setting: settingApi
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('preload', preload)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.preload = preload
}
