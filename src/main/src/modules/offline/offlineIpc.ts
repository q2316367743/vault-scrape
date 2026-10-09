/**
 * 离线数据包模块的 IPC 注册。
 *
 * 契约：
 * 1. 实现内部抛 `PluginError`，**只有 IPC 边界做信封转换**（跨 IPC 不抛异常）；
 * 2. 启动下载 / 本地导入都立即返回 jobId，进度与结果通过 `offline:progress` / `offline:done` 推送；
 * 3. 「从本地文件导入」的系统选择框由主进程弹出，渲染层只负责触发与展示结果。
 */
import { dialog, ipcMain } from 'electron'
import {
  describePluginError,
  pluginFail,
  pluginOk,
  type PluginResult
} from '@common/types/plugin'
import type { OfflineCheckResult, OfflinePackStatus } from '@common/types/offline'
import { OfflineChannels } from '~/modules/offline/offlineChannels'
import { checkOfflineUpdate } from './offlineCheck'
import { removeOfflinePack } from './offlineFileStore'
import { cancelOfflineJob, startOfflineLocalImportJob, startOfflineUpdateJob } from './offlineImporter'
import { offlineStatus } from './offlineRepo'

function handle<T>(task: () => Promise<T> | T): Promise<PluginResult<T>> {
  return Promise.resolve()
    .then(task)
    .then((data) => pluginOk(data))
    .catch((error: unknown) => {
      const { code, message } = describePluginError(error)
      return pluginFail(code, message)
    })
}

export function registerOfflineIpc(): void {
  ipcMain.handle(OfflineChannels.status, () => handle<OfflinePackStatus>(() => offlineStatus()))

  ipcMain.handle(OfflineChannels.check, () => handle<OfflineCheckResult>(() => checkOfflineUpdate()))

  ipcMain.handle(OfflineChannels.update, (event) =>
    handle(() => startOfflineUpdateJob(event.sender))
  )

  ipcMain.handle(OfflineChannels.importLocal, (event) =>
    handle(async () => {
      const picked = await dialog.showOpenDialog({
        title: '选择离线数据包',
        buttonLabel: '导入',
        filters: [{ name: '离线数据包', extensions: ['sql', 'gz'] }],
        properties: ['openFile']
      })
      if (picked.canceled || picked.filePaths.length === 0) {
        return { jobId: '', canceled: true }
      }
      const started = startOfflineLocalImportJob(event.sender, picked.filePaths[0])
      return { jobId: started.jobId, canceled: false }
    })
  )

  ipcMain.handle(OfflineChannels.cancel, () => handle(() => ({ canceled: cancelOfflineJob() })))

  ipcMain.handle(OfflineChannels.remove, () => handle(() => ({ removed: removeOfflinePack() })))
}
