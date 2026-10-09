/**
 * 刮削模块的错误码与错误类型。
 *
 * 契约：
 * - 实现内部抛 `ScrapeError`，只有 IPC 边界把它转换成 `ScrapeResult` 信封；
 * - 每个错误码都有中文文案，渲染层只按 `code` 做逻辑判断，不解析 message；
 * - 单文件刮削失败不抛异常，只记结果行；这里只表达「任务级」错误。
 */
export type ScrapeErrorCode =
  | 'busy'
  | 'notFound'
  | 'invalidArgument'
  | 'unsupported'
  | 'pluginMissing'
  | 'downloadFailed'
  | 'writeFailed'
  | 'moveFailed'
  | 'nfoFailed'
  | 'cancelled'
  | 'unknown'

export const SCRAPE_ERROR_CODES: readonly ScrapeErrorCode[] = [
  'busy',
  'notFound',
  'invalidArgument',
  'unsupported',
  'pluginMissing',
  'downloadFailed',
  'writeFailed',
  'moveFailed',
  'nfoFailed',
  'cancelled',
  'unknown'
]

export const SCRAPE_ERROR_MESSAGES: Readonly<Record<ScrapeErrorCode, string>> = {
  busy: '已有刮削任务在运行，请先等待或取消',
  notFound: '刮削任务不存在',
  invalidArgument: '参数不合法',
  unsupported: '当前连接不支持该操作',
  pluginMissing: '没有可用的刮削插件，请先在插件页导入并启用',
  downloadFailed: '资源下载失败',
  writeFailed: '写入文件失败',
  moveFailed: '移动文件失败',
  nfoFailed: '生成 NFO 失败',
  cancelled: '任务已取消',
  unknown: '未知错误'
}

/** 刮削模块统一错误：带错误码，message 一律为中文 */
export class ScrapeError extends Error {
  readonly code: ScrapeErrorCode

  constructor(code: ScrapeErrorCode, message?: string) {
    super(message ?? SCRAPE_ERROR_MESSAGES[code])
    this.name = 'ScrapeError'
    this.code = code
  }
}

/** 把任意异常收敛成错误码 + 中文文案，供 IPC 边界使用 */
export function describeScrapeError(error: unknown): { code: ScrapeErrorCode; message: string } {
  if (error instanceof ScrapeError) return { code: error.code, message: error.message }
  if (error instanceof Error) {
    return { code: 'unknown', message: error.message || SCRAPE_ERROR_MESSAGES.unknown }
  }
  return { code: 'unknown', message: SCRAPE_ERROR_MESSAGES.unknown }
}
