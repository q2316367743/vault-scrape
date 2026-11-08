/**
 * 应用信息：窗口启动时拿平台、版本与媒体服务基地址。
 *
 * 契约：窗口侧在挂载 Vue 之前调一次 `appInfo`，把 `mediaBase` 注入
 * `setMediaBaseUrl()`（渲染层打包的是 `@common` 的另一份副本），
 * 这样存储页自己拼的预览地址才会指向 core 的媒体服务。
 */
import { mediaBaseUrl } from '@common/types/media'
import { host } from './host'

export interface AppInfo {
  /** 宿主平台：macos / windows / linux */
  platform: 'macos' | 'windows' | 'linux'
  pluginId: string
  pluginVersion: string
  pluginName: string
  /** core 运行时 Node 版本（诊断用） */
  nodeVersion: string
  /** 媒体服务基地址（`http://127.0.0.1:<port>/p/<token>/`） */
  mediaBase: string
}

function platformOf(): AppInfo['platform'] {
  if (process.platform === 'darwin') return 'macos'
  if (process.platform === 'win32') return 'windows'
  return 'linux'
}

export const appApi = {
  appInfo: async (): Promise<AppInfo> => {
    const info = await host().plugin.info()
    return {
      platform: platformOf(),
      pluginId: info.id,
      pluginVersion: info.version,
      pluginName: info.name,
      nodeVersion: process.versions.node,
      mediaBase: mediaBaseUrl()
    }
  }
}
