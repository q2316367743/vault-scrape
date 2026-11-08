/**
 * 离线数据包域的 core API。
 *
 * 契约：
 * 1. 实现内部抛 `PluginError`，**只有 API 边界做信封转换**（不向窗口抛异常）；
 * 2. 启动下载 / 本地导入都立即返回 jobId，进度与结果通过事件推送；
 * 3. 「从本地文件导入」的系统选择框由 core 弹出（`ctx.dialog`），选中路径直接交给导入器。
 */
import {
  describePluginError,
  pluginFail,
  pluginOk,
  type PluginResult
} from '@common/types/plugin'
import type { OfflineCheckResult, OfflinePackStatus } from '@common/types/offline'
import { checkOfflineUpdate } from './offlineCheck'
import { removeOfflinePack } from './offlineFileStore'
import { cancelOfflineJob, startOfflineLocalImportJob, startOfflineUpdateJob } from './offlineImporter'
import { offlineStatus } from './offlineRepo'
import { host } from '../../runtime/host'

function handle<T>(task: () => Promise<T> | T): Promise<PluginResult<T>> {
  return Promise.resolve()
    .then(task)
    .then((data) => pluginOk(data))
    .catch((error: unknown) => {
      const { code, message } = describePluginError(error)
      return pluginFail(code, message)
    })
}

export const offlineApi = {
  offlineStatus: (): Promise<PluginResult<OfflinePackStatus>> =>
    handle<OfflinePackStatus>(() => offlineStatus()),

  offlineCheck: (): Promise<PluginResult<OfflineCheckResult>> =>
    handle<OfflineCheckResult>(() => checkOfflineUpdate()),

  offlineUpdate: (): Promise<PluginResult<{ jobId: string }>> =>
    handle(() => startOfflineUpdateJob()),

  offlineImportLocal: (): Promise<PluginResult<{ jobId: string; canceled: boolean }>> =>
    handle(async () => {
      const picked = await host().dialog.open({
        title: '选择离线数据包',
        filters: [{ name: '离线数据包', extensions: ['sql', 'gz'] }]
      })
      if (picked.length === 0) {
        return { jobId: '', canceled: true }
      }
      const started = startOfflineLocalImportJob(picked[0])
      return { jobId: started.jobId, canceled: false }
    }),

  offlineCancel: (): Promise<PluginResult<{ canceled: boolean }>> =>
    handle(() => ({ canceled: cancelOfflineJob() })),

  offlineRemove: (): Promise<PluginResult<{ removed: boolean }>> =>
    handle(() => ({ removed: removeOfflinePack() }))
}
