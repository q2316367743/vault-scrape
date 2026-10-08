/**
 * 插件列表的页面状态：加载、选中、启停、导入、删除与源码读写。
 *
 * 选中项持久化到 localStorage；该插件被删除后自动回落到第一个可用插件。
 */
import { computed, ref } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import { MessagePlugin } from 'tdesign-vue-next'
import { pluginApi } from '@/api'
import type { PluginImportResult, PluginSummary } from '@common/types/plugin'

const ACTIVE_PLUGIN_KEY = 'vault-scrape:plugin-active'

export function usePlugins() {
  const storedActiveId = useLocalStorage(ACTIVE_PLUGIN_KEY, '')
  const plugins = ref<PluginSummary[]>([])
  const loading = ref(false)
  const activeId = ref(storedActiveId.value)

  const active = computed(() => plugins.value.find((item) => item.id === activeId.value) ?? null)

  function select(id: string): void {
    activeId.value = id
    storedActiveId.value = id
  }

  function applySummary(summary: PluginSummary): void {
    plugins.value = plugins.value.map((item) => (item.id === summary.id ? summary : item))
  }

  async function refresh(): Promise<void> {
    loading.value = true
    const result = await pluginApi.list()
    loading.value = false
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return
    }
    plugins.value = result.data
    const exists = result.data.some((item) => item.id === activeId.value)
    if (!exists) select(result.data[0]?.id ?? '')
  }

  async function setEnabled(plugin: PluginSummary, enabled: boolean): Promise<void> {
    const result = await pluginApi.setEnabled(plugin.id, enabled)
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return
    }
    applySummary(result.data)
  }

  async function remove(plugin: PluginSummary): Promise<void> {
    const result = await pluginApi.remove(plugin.id)
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return
    }
    MessagePlugin.success(`已删除插件「${plugin.name}」`)
    await refresh()
  }

  /** 导入本机插件文件；取消选择时返回 null */
  async function importPlugins(overwrite = false): Promise<PluginImportResult | null> {
    const result = await pluginApi.import(overwrite)
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return null
    }
    await refresh()
    return result.data
  }

  async function readCode(id: string): Promise<string | null> {
    const result = await pluginApi.readCode(id)
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return null
    }
    return result.data
  }

  async function saveCode(id: string, code: string): Promise<boolean> {
    const result = await pluginApi.saveCode(id, code)
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return false
    }
    applySummary(result.data)
    MessagePlugin.success('插件已保存并通过校验')
    return true
  }

  return {
    plugins,
    loading,
    activeId,
    active,
    refresh,
    select,
    setEnabled,
    remove,
    importPlugins,
    readCode,
    saveCode
  }
}
