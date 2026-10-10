/**
 * 资料库模块的错误码与中文文案。
 *
 * 契约：模块内部抛 `LibraryError`，只在 IPC 边界转成 `LibraryResult` 信封；
 * 渲染层只按 `code` 判断，不解析 message。
 */
export type LibraryErrorCode =
  | 'notFound'
  | 'invalidArgument'
  | 'connectionMissing'
  | 'busy'
  | 'scanFailed'
  | 'scrapeFailed'
  | 'pluginMissing'
  | 'cancelled'
  | 'unknown'

export const LIBRARY_ERROR_MESSAGES: Readonly<Record<LibraryErrorCode, string>> = {
  notFound: '资料库不存在',
  invalidArgument: '资料库参数不合法',
  connectionMissing: '所属存储不存在，请先在存储页创建',
  busy: '已有任务在运行，请稍候',
  scanFailed: '扫描失败',
  scrapeFailed: '刮削启动失败',
  pluginMissing: '没有可用的刮削插件，请先在插件页安装并启用插件',
  cancelled: '扫描已取消',
  unknown: '未知错误'
}

export class LibraryError extends Error {
  readonly code: LibraryErrorCode

  constructor(code: LibraryErrorCode, message?: string) {
    super(message && message.length > 0 ? message : LIBRARY_ERROR_MESSAGES[code])
    this.name = 'LibraryError'
    this.code = code
  }
}

/** IPC 边界用：任何异常都收敛成「码 + 中文文案」 */
export function describeLibraryError(error: unknown): { code: LibraryErrorCode; message: string } {
  if (error instanceof LibraryError) return { code: error.code, message: error.message }
  if (error instanceof Error && error.message.length > 0) {
    return { code: 'unknown', message: error.message }
  }
  return { code: 'unknown', message: LIBRARY_ERROR_MESSAGES.unknown }
}
