/**
 * 存储弹窗的刮削器候选项。
 *
 * 契约：
 * - 只列出「已启用且编译通过」的插件：停用或加载失败的插件即便被存储选中也不会生效，因此不进候选；
 * - 存储里已经配置、但当前不在候选中的 id 由 `unavailable()` 交给界面提示，不静默清除用户配置。
 */
import { ref } from 'vue'
import { pluginApi } from '@/api'
import { isPluginOk, type PluginSummary } from '@common/types/plugin'

export interface ScraperOption {
  label: string
  value: string
  version: string
}

function isUsable(plugin: PluginSummary): boolean {
  return plugin.enabled && plugin.loadError.length === 0
}

function toOption(plugin: PluginSummary): ScraperOption {
  return { label: `${plugin.name}（${plugin.id}）`, value: plugin.id, version: plugin.version }
}

export function useScraperOptions() {
  const options = ref<ScraperOption[]>([])
  const loading = ref(false)

  async function load(): Promise<void> {
    loading.value = true
    const result = await pluginApi.list()
    loading.value = false
    if (!isPluginOk(result)) return
    options.value = result.data.filter(isUsable).map(toOption)
  }

  /** 配置里存在但当前不可用的刮削器 id（插件被删除 / 停用 / 编译失败） */
  function unavailable(ids: string[]): string[] {
    const known = new Set(options.value.map((item) => item.value))
    return ids.filter((id) => !known.has(id))
  }

  return { options, loading, load, unavailable }
}
