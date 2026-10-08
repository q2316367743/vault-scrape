/**
 * 文件模块的错误码与错误类型。
 *
 * 契约：
 * - 实现类内部抛 `FileError`，只有 IPC 边界把它转换成 `FileResult` 信封；
 * - 每个错误码都有中文文案，渲染层只按 `code` 做逻辑判断，不解析 message；
 * - 归一化与收窄绝不引入 any。
 */
export type FileErrorCode =
  | 'notFound'
  | 'alreadyExists'
  | 'notDirectory'
  | 'notEmpty'
  | 'permissionDenied'
  | 'invalidPath'
  | 'invalidArgument'
  | 'authFailed'
  | 'unsupported'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'unknown'

export const FILE_ERROR_CODES: readonly FileErrorCode[] = [
  'notFound',
  'alreadyExists',
  'notDirectory',
  'notEmpty',
  'permissionDenied',
  'invalidPath',
  'invalidArgument',
  'authFailed',
  'unsupported',
  'network',
  'timeout',
  'cancelled',
  'unknown'
]

export const FILE_ERROR_MESSAGES: Readonly<Record<FileErrorCode, string>> = {
  notFound: '目标不存在',
  alreadyExists: '目标已存在',
  notDirectory: '目标不是目录',
  notEmpty: '目录非空',
  permissionDenied: '没有访问权限',
  invalidPath: '路径不合法',
  invalidArgument: '参数不合法',
  authFailed: '认证失败，请检查账号或密码',
  unsupported: '当前协议不支持该操作',
  network: '网络异常，无法连接到远端',
  timeout: '操作超时',
  cancelled: '操作已取消',
  unknown: '未知错误'
}

/** 文件模块统一错误：带错误码，message 一律为中文 */
export class FileError extends Error {
  readonly code: FileErrorCode

  constructor(code: FileErrorCode, message?: string) {
    super(message ?? FILE_ERROR_MESSAGES[code])
    this.name = 'FileError'
    this.code = code
  }
}

/** 把任意异常收敛成错误码 + 中文文案，供 IPC 边界使用 */
export function describeFileError(error: unknown): { code: FileErrorCode; message: string } {
  if (error instanceof FileError) return { code: error.code, message: error.message }
  if (error instanceof Error) {
    return { code: 'unknown', message: error.message || FILE_ERROR_MESSAGES.unknown }
  }
  return { code: 'unknown', message: FILE_ERROR_MESSAGES.unknown }
}
