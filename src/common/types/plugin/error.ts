/**
 * 插件模块的错误码与错误类型。
 *
 * 契约：
 * - 实现内部抛 `PluginError`，只有 IPC 边界把它转换成 `PluginResult` 信封；
 * - 每个错误码都有中文文案，渲染层只按 `code` 做逻辑判断，不解析 message；
 * - 归一化与收窄绝不引入 any。
 */
export type PluginErrorCode =
  | 'notFound'
  | 'duplicate'
  | 'invalidPlugin'
  | 'invalidArgument'
  | 'unsupported'
  | 'evalFailed'
  | 'timeout'
  | 'invokeFailed'
  | 'envMissing'
  | 'io'
  | 'offlineMissing'
  | 'offlineBusy'
  | 'offlineCorrupt'
  | 'offlineCheckFailed'
  | 'unknown'

export const PLUGIN_ERROR_CODES: readonly PluginErrorCode[] = [
  'notFound',
  'duplicate',
  'invalidPlugin',
  'invalidArgument',
  'unsupported',
  'evalFailed',
  'timeout',
  'invokeFailed',
  'envMissing',
  'io',
  'offlineMissing',
  'offlineBusy',
  'offlineCorrupt',
  'offlineCheckFailed',
  'unknown'
]

export const PLUGIN_ERROR_MESSAGES: Readonly<Record<PluginErrorCode, string>> = {
  notFound: '插件不存在',
  duplicate: '同 ID 的插件已存在',
  invalidPlugin: '插件定义不合法',
  invalidArgument: '参数不合法',
  unsupported: '插件不支持该操作',
  evalFailed: '插件代码执行失败',
  timeout: '插件执行超时',
  invokeFailed: '插件调用失败',
  envMissing: '插件缺少必填配置',
  io: '插件文件读写失败',
  offlineMissing: '尚未安装离线数据包',
  offlineBusy: '已有离线数据包任务在进行中',
  offlineCorrupt: '离线数据包已损坏，请重新导入',
  offlineCheckFailed: '检查离线数据包更新失败',
  unknown: '未知错误'
}

/** 插件模块统一错误：带错误码，message 一律为中文 */
export class PluginError extends Error {
  readonly code: PluginErrorCode

  constructor(code: PluginErrorCode, message?: string) {
    super(message ?? PLUGIN_ERROR_MESSAGES[code])
    this.name = 'PluginError'
    this.code = code
  }
}

/** 把任意异常收敛成错误码 + 中文文案，供 IPC 边界使用 */
export function describePluginError(error: unknown): { code: PluginErrorCode; message: string } {
  if (error instanceof PluginError) return { code: error.code, message: error.message }
  if (error instanceof Error) {
    return { code: 'unknown', message: error.message || PLUGIN_ERROR_MESSAGES.unknown }
  }
  return { code: 'unknown', message: PLUGIN_ERROR_MESSAGES.unknown }
}
