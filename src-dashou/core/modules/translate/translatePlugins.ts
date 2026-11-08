/**
 * 翻译插件的挑选。
 *
 * 契约（与 `scrapeUsablePlugins` 同款，但按类别换成 `translatePlugins`）：
 * - 「能用」只有一条判定 `isPluginUsable`（已启用 + 编译通过 + 必填环境变量都填了），
 *   主进程与渲染层共用，弹窗里禁用哪些插件也照这一条；
 * - **插件的先后顺序就是插件页的顺序**（`listPluginSummaries` 已按序返回），
 *   所以「自动选择」= 排在第一个能用的插件；
 * - 显式指定了插件就走指定的那个：插件已不存在当作没指定（回落到自动选择），
 *   存在但不可用报 `pluginUnusable`（不静默换一个，用户以为是这个插件翻的）。
 */
import { isPluginUsable, type PluginSummary } from '@common/types/plugin'
import { TranslateError } from '@common/types/translate'
import { translatePlugins } from '$/modules/plugin/pluginRegistries'

/** 全部翻译插件，顺序即插件页顺序 */
export function listTranslatePlugins(): PluginSummary[] {
  return translatePlugins.listPluginSummaries()
}

/** 能用的翻译插件 */
export function usableTranslatePlugins(): PluginSummary[] {
  return listTranslatePlugins().filter(isPluginUsable)
}

/**
 * 选一个翻译插件。
 *
 * `preferredId` 为空 = 自动选择（按插件页顺序取第一个能用的）。
 * 一个都不能用时按原因报错：装了但没一个能用 → `pluginUnusable`；
 * 一个都没装 / 装了但都没启用 → `pluginMissing`。
 */
export function pickTranslatePlugin(preferredId = ''): PluginSummary {
  const plugins = listTranslatePlugins()
  const usable = plugins.filter(isPluginUsable)
  const id = preferredId.trim()
  if (id.length > 0) {
    const preferred = usable.find((plugin) => plugin.id === id)
    if (preferred) return preferred
    const exists = plugins.some((plugin) => plugin.id === id)
    throw new TranslateError(exists ? 'pluginUnusable' : 'pluginMissing')
  }
  const first = usable[0]
  if (first) return first
  const hasEnabled = plugins.some((plugin) => plugin.enabled && plugin.loadError.length === 0)
  throw new TranslateError(hasEnabled ? 'pluginUnusable' : 'pluginMissing')
}
