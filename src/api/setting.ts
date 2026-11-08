/**
 * 设置的渲染层入口：按分组读写，整树落盘由 core 负责。
 */
import { toRaw } from 'vue'
import type { SettingGroupKey, SettingSchema } from '@common/types/setting'
import { callCore } from './invoke'

/**
 * 去掉 Vue 响应式包装，得到可结构化克隆的纯值。
 *
 * 宿主的跨进程通道同样不接受 Proxy（报 could not be cloned），调用方可以直接传
 * 响应式对象，由这里统一转成纯值。
 */
function toPlainValue<V>(value: V): V {
  return structuredClone(toRaw(value))
}

export const settingApi = {
  getAll: (): Promise<SettingSchema> => callCore('settingGetAll'),

  getGroup: <K extends SettingGroupKey>(key: K): Promise<SettingSchema[K]> =>
    callCore('settingGetGroup', { key }),

  // 声明为 async：让 toPlainValue / invoke 的同步抛错变成 rejected promise，调用方的 catch 才接得住
  saveGroup: async <K extends SettingGroupKey>(
    key: K,
    value: SettingSchema[K]
  ): Promise<SettingSchema> =>
    callCore('settingSaveGroup', { key, value: toPlainValue(value) })
}

export type SettingApi = typeof settingApi
