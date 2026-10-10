/**
 * 内置插件的常量。
 *
 * 契约：内置插件随应用分发、不落盘、不可删除（见 main 的 `builtinPlugins`）。
 * 渲染层（资料库表单的默认刮削器）与主进程（注册表、离线面板挂载）必须用同一个
 * ID，因此常量放在 common 层，谁都不许再各写一份字面量。
 */

/** r18.dev 离线数据包：本机全量番号库，作为刮削的保底数据源 */
export const R18_OFFLINE_PLUGIN_ID = 'r18-offline'
