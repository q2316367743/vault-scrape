import { registerDbIpc } from './db/dbIpc'
import { registerAppWindowIpc } from './modules/appWindow/appWindowIpc'
import { registerFileIpc } from './modules/file/fileIpc'
import { registerPluginIpc } from './modules/plugin/pluginIpc'
import { registerSettingIpc } from './modules/setting/settingIpc'

/** IPC 注册总入口：新增一个域就在这里挂一行 */
export function registerIpc(): void {
  registerDbIpc()
  registerAppWindowIpc()
  registerFileIpc()
  registerPluginIpc()
  registerSettingIpc()
}
