/**
 * 应用信息：窗口启动时拉一次，提供给「关于」页与需要平台判断的组件。
 *
 * 同时把 core 媒体服务的基地址注入渲染层的 `@common` 副本（存储页会自己拼预览地址），
 * 所以必须在挂载 Vue 之前调用 `initAppInfo()`。
 */
import { setMediaBaseUrl } from '@common/types/media'
import { callCore } from './invoke'

export interface AppInfo {
  platform: 'macos' | 'windows' | 'linux'
  pluginId: string
  pluginVersion: string
  pluginName: string
  nodeVersion: string
  mediaBase: string
}

let cached: AppInfo | null = null

export async function initAppInfo(): Promise<AppInfo> {
  const info = await callCore<AppInfo>('appInfo')
  setMediaBaseUrl(info.mediaBase)
  cached = info
  return info
}

export function appInfo(): AppInfo {
  if (!cached) {
    throw new Error('应用信息尚未初始化')
  }
  return cached
}

/** 是否 macOS（标题栏等需要平台判断的地方用） */
export function isMac(): boolean {
  return cached?.platform === 'macos'
}
