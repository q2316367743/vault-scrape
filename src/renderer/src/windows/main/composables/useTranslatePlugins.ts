/**
 * 翻译插件的候选与状态。
 *
 * 契约：
 * - 一次读全类别的插件（`plugin:translate:list`），**不做任何过滤**：界面要区分
 *   「一个插件都没有」「有插件但都没启用」「启用了但都不可用」三种情况，过滤掉就看不出来了；
 * - 可用判定只有一个来源：`isPluginUsable`（启用 + 加载成功 + 必填环境变量已填），
 *   主进程挑插件用的是同一份，两边不许各写一套；
 * - `translatePluginHint` 给不可用插件一句界面文案，只说结论，不讲插件内部机制。
 */
import { computed, ref } from 'vue'
import { pluginApi } from '@/api'
import { isPluginOk, isPluginUsable, type PluginSummary } from '@common/types/plugin'

/** 不可用插件在界面上的一句话原因；可用时是空串 */
export function translatePluginHint(plugin: PluginSummary): string {
  if (plugin.loadError.length > 0) return '插件加载失败'
  if (!plugin.enabled) return '未启用'
  if (!plugin.envReady) return '需要先补全插件设置'
  return ''
}

/** 详情页「翻译」的四种状态 */
export type TranslatePluginState = 'empty' | 'disabled' | 'unusable' | 'ready'

export function useTranslatePlugins() {
  const plugins = ref<PluginSummary[]>([])
  const loading = ref(false)

  async function load(): Promise<void> {
    loading.value = true
    const result = await pluginApi.translate.list()
    loading.value = false
    if (!isPluginOk(result)) return
    plugins.value = result.data
  }

  /** 现在就能直接用的翻译插件（顺序 = 插件页顺序） */
  const usable = computed(() => plugins.value.filter(isPluginUsable))

  /**
   * 四种状态，详情页据此决定是提示还是弹窗选插件：
   * `empty` 一个翻译插件都没有；`disabled` 有插件但都没启用；
   * `unusable` 有启用的但都不可用；`ready` 至少一个可用。
   */
  const state = computed<TranslatePluginState>(() => {
    if (plugins.value.length === 0) return 'empty'
    if (usable.value.length > 0) return 'ready'
    if (plugins.value.every((plugin) => !plugin.enabled)) return 'disabled'
    return 'unusable'
  })

  return { plugins, usable, loading, state, load }
}
