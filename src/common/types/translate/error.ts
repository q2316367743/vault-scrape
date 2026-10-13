/**
 * 翻译域的错误码与错误类型。
 *
 * 契约（与媒体 / 刮削域同款）：
 * - 实现内部抛 `TranslateError`，只有 IPC 边界把它转换成 `TranslateResult` 信封；
 * - 每个错误码都有中文文案**且文案本身就是给用户看的成品句**（渲染层会原样显示），
 *   所以这里不写插件 ID、通道名、堆栈这类实现细节，技术细节走 `appendLog`；
 * - **没有「未启用」这个码**：`setting.translate.enabled` 只决定刮削后要不要自动翻译，
 *   手动翻译永远可做，所以手动路径不会因为开关关闭而失败。
 */
export type TranslateErrorCode =
  | 'invalidItem'
  | 'pluginMissing'
  | 'pluginUnusable'
  | 'busy'
  | 'invokeFailed'

export const TRANSLATE_ERROR_CODES: readonly TranslateErrorCode[] = [
  'invalidItem',
  'pluginMissing',
  'pluginUnusable',
  'busy',
  'invokeFailed'
]

export const TRANSLATE_ERROR_MESSAGES: Readonly<Record<TranslateErrorCode, string>> = {
  invalidItem: '找不到这个条目，请刷新后重试。',
  pluginMissing: '没有可用的翻译插件，请先到插件页启用一个。',
  pluginUnusable: '这个翻译插件还不能用，请先到插件页处理。',
  busy: '这个条目正在翻译，请稍候。',
  invokeFailed: '翻译失败，请稍后重试。'
}

/** 翻译统一错误：带错误码，message 一律是给用户看的中文成品句 */
export class TranslateError extends Error {
  readonly code: TranslateErrorCode

  constructor(code: TranslateErrorCode, message?: string) {
    super(message ?? TRANSLATE_ERROR_MESSAGES[code])
    this.name = 'TranslateError'
    this.code = code
  }
}

/** 把任意异常收敛成错误码 + 中文文案，供 IPC 边界使用 */
export function describeTranslateError(error: unknown): {
  code: TranslateErrorCode
  message: string
} {
  if (error instanceof TranslateError) return { code: error.code, message: error.message }
  if (error instanceof Error) {
    return { code: 'invokeFailed', message: error.message || TRANSLATE_ERROR_MESSAGES.invokeFailed }
  }
  return { code: 'invokeFailed', message: TRANSLATE_ERROR_MESSAGES.invokeFailed }
}
