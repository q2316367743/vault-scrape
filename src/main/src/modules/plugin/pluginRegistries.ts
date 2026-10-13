/**
 * 三类插件注册表实例：影片信息 / 演员信息 / 翻译。
 *
 * 契约：调用方按类别引用对应实例，绝不跨类别调用——影片刮削链路（scrapeRunner /
 * scrapeJobPlan / 工具页）用 `moviePlugins`，演员链路（actorScrape）用 `actorPlugins`，
 * 插件管理页三个 tab 各自用自己的实例；`translatePlugins` 由翻译链路
 * （`modules/translate/translatePlugins.ts` 挑插件、`itemTranslate.ts` 逐字段调用）使用。
 */
import { createPluginRegistry } from './pluginRegistry'

/** 影片信息插件：搜索 / 详情 / 封面 / 花絮 */
export const moviePlugins = createPluginRegistry('movie')

/** 演员信息插件：演员资料与头像图集 */
export const actorPlugins = createPluginRegistry('actor')

/** 翻译插件：类别预留，暂无方法可调用 */
export const translatePlugins = createPluginRegistry('translate')
