import { registerDbIpc } from './db/dbIpc'
import { registerAppWindowIpc } from './modules/appWindow/appWindowIpc'
import { registerDialogIpc } from './modules/dialog/dialogIpc'
import { registerFileIpc } from './modules/file/fileIpc'
import { registerMediaIpc } from './modules/media/mediaIpc'
import { registerOfflineIpc } from './modules/offline/offlineIpc'
import { registerPluginIpc } from './modules/plugin/pluginIpc'
import { registerScrapeIpc } from './modules/scrape/scrapeIpc'
import { registerSettingIpc } from './modules/setting/settingIpc'

/** IPC 注册总入口：新增一个域就在这里挂一行 */
export function registerIpc(): void {
  registerDbIpc()
  registerAppWindowIpc()
  registerDialogIpc()
  registerFileIpc()
  registerMediaIpc()
  registerOfflineIpc()
  registerPluginIpc()
  registerScrapeIpc()
  registerSettingIpc()
}
