/**
 * 「资料库绑定的刮削器 ∩ 当前可用插件」的挑选口径（`scrapeRunner` 的配套小模块）。
 *
 * 批量任务与详情页的手动匹配共用这一份挑选：只认 `library.scrapers`（**不再回落到存储配置**），
 * 顺序只看插件页排序，不听配置顺序；空清单是合法状态（该库不刮削），
 * 由调用方按「未配置刮削器」与「配置了但都不可用」给不同中文提示。
 */
import type { PluginSummary } from '@common/types/plugin'
import { ScrapeError } from '@common/types/scrape'
import { moviePlugins } from '$/modules/plugin/pluginRegistries'
import type { ScrapePluginRef } from './scrapeJobTypes'

/** 某个资料库可用的刮削器；`configuredCount` 用于区分「一个没装」和「装了但没勾」 */
export interface LibraryPlugins {
  list: ScrapePluginRef[]
  configuredCount: number
}

/** 资料库里配的刮削器 ∩ 当前可用插件（顺序按插件页），供任务与手动匹配共用 */
export function usablePlugins(scraperIds: readonly string[]): LibraryPlugins {
  const all = moviePlugins
    .listPluginSummaries()
    .filter((plugin: PluginSummary) => plugin.enabled && plugin.loadError.length === 0)
    .map((plugin) => ({ id: plugin.id, name: plugin.name }))
  const configured = [...new Set(scraperIds.filter((id) => id.length > 0))]
  if (configured.length === 0) return { list: [], configuredCount: 0 }
  const wanted = new Set(configured)
  return { list: all.filter((plugin) => wanted.has(plugin.id)), configuredCount: configured.length }
}

/** 取可用插件；为空时按原因给出不同提示 */
export function assertUsablePlugins(scraperIds: readonly string[]): ScrapePluginRef[] {
  const plugins = usablePlugins(scraperIds)
  if (plugins.list.length > 0) return plugins.list
  throw plugins.configuredCount === 0
    ? new ScrapeError('pluginMissing', '该资料库未配置刮削器（空刮削器表示不刮削），请先在资料库设置里选择')
    : new ScrapeError('pluginMissing', '资料库配置的刮削器均不可用，请重新选择')
}
