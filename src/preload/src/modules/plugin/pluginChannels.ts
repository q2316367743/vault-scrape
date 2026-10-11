/**
 * plugin 域 IPC 契约：通道常量。
 *
 * 每个插件类别一套通道（`plugin:<类别>:<动作>`），类别之间互相独立；
 * preload 桥与 main handler 共用这一份定义（main 通过别名 ~ 引用）。
 * 旧的平铺插件目录检查是全局的，单列一个通道。
 */
import type { PluginKind } from '@common/types/plugin'

export type PluginChannelAction =
  | 'list'
  | 'readCode'
  | 'saveCode'
  | 'import'
  | 'remove'
  | 'setEnabled'
  | 'reorder'
  | 'getEnv'
  | 'saveEnv'
  | 'invoke'

export type PluginChannels = Readonly<Record<PluginChannelAction, string>>

/** 某个类别的全部 IPC 通道 */
export function channelsOf(kind: PluginKind): PluginChannels {
  return {
    list: `plugin:${kind}:list`,
    readCode: `plugin:${kind}:readCode`,
    saveCode: `plugin:${kind}:saveCode`,
    import: `plugin:${kind}:import`,
    remove: `plugin:${kind}:remove`,
    setEnabled: `plugin:${kind}:setEnabled`,
    reorder: `plugin:${kind}:reorder`,
    getEnv: `plugin:${kind}:getEnv`,
    saveEnv: `plugin:${kind}:saveEnv`,
    invoke: `plugin:${kind}:invoke`
  }
}

/** 旧版平铺插件目录的残留检查（与类别无关） */
export const PLUGIN_LEGACY_CHANNEL = 'plugin:legacy'
