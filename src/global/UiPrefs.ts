/**
 * 窗口 UI 偏好的响应式存储。
 *
 * 契约：
 * - 偏好存 core 的配置目录（`ui-prefs.json`），不再用 localStorage —— 沙箱数据会被清理，换设备也带不走；
 * - 内存里只有一份响应式 store，读是 live computed；`loadUiPrefs()` 在窗口 bootstrap 时
 *   拉一次 core 全量回填，回填后所有偏好自动更新，无需手动同步；
 * - 写入先改内存（界面立即响应），再 fire-and-forget 交给 core 落盘；不同键的并发写由 core 串行处理；
 * - 两个窗口（main / play）各自持有缓存，都从 core 读同一份数据。
 */
import { computed, ref, type Ref } from 'vue'
import { settingApi } from '@/api'

const store = ref<Record<string, unknown>>({})
let loaded = false

/** 窗口启动时从 core 拉一次全量偏好；重复调用只拉一次 */
export async function loadUiPrefs(): Promise<void> {
  if (loaded) return
  loaded = true
  try {
    const prefs = await settingApi.getUiPrefs()
    if (prefs && typeof prefs === 'object') store.value = prefs
  } catch {
    // core 暂不可用时沿用默认值，不阻塞窗口启动
  }
}

/**
 * 取一个 UI 偏好：读写都走内存 store（live），写入额外异步落盘。
 * 泛型 T 决定默认值类型；core 里的值直接透传，调用方负责类型收窄。
 */
export function useUiPref<T>(key: string, fallback: T): Ref<T> {
  return computed<T>({
    get: (): T => {
      const value = store.value[key]
      return value === undefined ? fallback : (value as T)
    },
    set: (value: T): void => {
      store.value = { ...store.value, [key]: value }
      void settingApi.setUiPref(key, value).catch(() => undefined)
    }
  })
}
