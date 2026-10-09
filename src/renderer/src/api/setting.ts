import { toRaw } from 'vue'
import type { SettingGroupKey, SettingSchema } from '@common/types/setting'

/**
 * 渲染层读写设置的统一出口。
 * 页面与 store 只从这里取 API，不直接触碰 window.preload（见 AGENTS.md）。
 */

/**
 * 去掉 Vue 响应式包装，得到可以通过 IPC 结构化克隆的纯值。
 *
 * ref/reactive 会把对象包成 Proxy，而 Proxy 过不了 ipcRenderer 的结构化克隆
 * （报 `#<Object> could not be cloned`），主进程一个字节都收不到。
 * 调用方因此可以直接传响应式对象，由这里统一转成纯值。
 */
function toIpcValue<V>(value: V): V {
  return structuredClone(toRaw(value))
}

export const settingApi = {
  getAll: (): Promise<SettingSchema> => window.preload.setting.getAll(),
  getGroup: <K extends SettingGroupKey>(key: K): Promise<SettingSchema[K]> =>
    window.preload.setting.getGroup(key),
  // 声明为 async：让 toIpcValue / invoke 的同步抛错变成 rejected promise，调用方的 catch 才接得住
  saveGroup: async <K extends SettingGroupKey>(
    key: K,
    value: SettingSchema[K]
  ): Promise<SettingSchema> => window.preload.setting.saveGroup(key, toIpcValue(value))
}
