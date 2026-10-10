/**
 * 内置插件：随应用分发、用原生 TypeScript 实现，不走 `node:vm` 沙箱。
 *
 * 契约：
 * 1. 内置插件没有 `.js` 源码，不落盘、不可编辑、不可删除（见 `pluginStore` 的守卫）；
 * 2. 与 JS 插件共用同一套调用入口 `pluginRegistry.invokePlugin`，因此同样支持启停与测试面板；
 * 3. 数据缺失、库损坏等一律由实现体抛 `PluginError`（如 `offlineMissing`）。
 */
import { R18_OFFLINE_PLUGIN_ID } from '@common/types/plugin'
import type {
  PluginEnvField,
  PluginInvokeData,
  PluginMeta,
  PluginMethod
} from '@common/types/plugin'
import {
  offlineCovers,
  offlineDetail,
  offlineExtras,
  offlineSearch
} from '$/modules/offline/offlineRepo'

export interface BuiltinPlugin {
  meta: PluginMeta
  env: PluginEnvField[]
  invoke: (method: PluginMethod, argument: string) => Promise<PluginInvokeData>
}

/** 内置插件 ID 由公共层定义（渲染层也要用），这里只做再导出，全仓库不留第二份字面量 */
export { R18_OFFLINE_PLUGIN_ID }

/**
 * r18.dev 离线数据包：本机全量番号库，作为在线刮削的保底数据源。
 * 元信息与标题/演员/发行信息全部离线可得；图片与预告片仍需联网从 DMM 获取。
 */
async function invokeR18Offline(method: PluginMethod, argument: string): Promise<PluginInvokeData> {
  if (method === 'search') return offlineSearch(argument, 50)
  if (method === 'detail') return offlineDetail(argument)
  if (method === 'covers') return offlineCovers(argument)
  return offlineExtras(argument)
}

export const BUILTIN_PLUGINS: BuiltinPlugin[] = [
  {
    meta: {
      id: R18_OFFLINE_PLUGIN_ID,
      name: 'R18 离线数据包',
      version: '1.0.0',
      author: 'vault-scrape',
      description:
        '使用 r18.dev 每月全量数据包在本机离线刮削番号、标题、演员、类别与发行信息，作为在线刮削的保底数据源；封面与预告片仍需联网从 DMM 获取。',
      homepage: 'https://r18.dev/dumps'
    },
    env: [],
    invoke: invokeR18Offline
  }
]

export function findBuiltinPlugin(id: string): BuiltinPlugin | null {
  return BUILTIN_PLUGINS.find((item) => item.meta.id === id) ?? null
}
