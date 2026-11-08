/**
 * 已启用存储插件的全局缓存：协议选择、连接列表展示名都要用它。
 *
 * 契约：
 * - 模块级单例：多个组件共享同一份列表，`refresh()` 拉取后原地更新；
 * - 只暴露「已启用且可加载」的插件（`loadError` 非空的不可用）；
 * - `fieldsOf` 拉单个插件的连接配置字段声明（敏感字段标记在字段上），失败回落空表。
 */
import { computed, ref } from 'vue'
import { isPluginUsable, type PluginEnvField, type PluginSummary } from '@common/types/plugin'
import { pluginApi } from '@/api'

const plugins = ref<PluginSummary[]>([])
let loading: Promise<void> | null = null

/** 已启用的存储插件（含首次懒加载） */
export function useStoragePlugins() {
  const usable = computed(() => plugins.value.filter(isPluginUsable))

  async function refresh(): Promise<void> {
    if (loading) return loading
    loading = pluginApi.storage
      .list()
      .then((result) => {
        if (result.ok) plugins.value = result.data
      })
      .finally(() => {
        loading = null
      })
    return loading
  }

  const fieldsCache = new Map<string, PluginEnvField[]>()

  /** 拉单个插件的连接配置字段声明；插件不存在或加载失败回落空表 */
  async function fieldsOf(pluginId: string): Promise<PluginEnvField[]> {
    const cached = fieldsCache.get(pluginId)
    if (cached) return cached
    const result = await pluginApi.storage.getEnv(pluginId)
    const fields = result.ok ? result.data.fields : []
    fieldsCache.set(pluginId, fields)
    return fields
  }

  function nameOf(pluginId: string): string {
    return plugins.value.find((item) => item.id === pluginId)?.name ?? pluginId
  }

  /** 插件描述（协议说明用），没有则空串 */
  function descriptionOf(pluginId: string): string {
    return plugins.value.find((item) => item.id === pluginId)?.description ?? ''
  }

  void refresh()

  return { plugins: usable, refresh, fieldsOf, nameOf, descriptionOf }
}
