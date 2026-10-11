import type { PluginKind } from '@common/types/plugin'

export const pluginApi = window.preload.plugin

/**
 * 单个类别的插件桥：三类插件的管理方法同名同签名；
 * 影片桥另外多出 search / detail / covers / extras 四个调用快捷方法。
 */
export type PluginBridge = typeof pluginApi.actor

/**
 * 按类别取插件桥。
 *
 * 页面以 `kind` 为参数复用同一套管理逻辑时从这里取，避免在每个调用点写三元表达式。
 */
export function pluginBridge(kind: PluginKind): PluginBridge {
  return pluginApi[kind]
}
