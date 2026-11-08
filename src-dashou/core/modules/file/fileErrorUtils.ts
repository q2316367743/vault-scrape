import { FILE_ERROR_MESSAGES, FileError, type FileErrorCode } from '@common/types/file'

/**
 * 把底层库（node:fs / webdav / smb2）抛出的异常收敛成 FileError。
 *
 * 契约：优先识别 FileError，其次按 Node 错误码、HTTP 状态码依次映射，
 * 都识别不出时回落调用方给的兜底错误码；绝不引入 any。
 */
const NODE_CODE_MAP: Readonly<Record<string, FileErrorCode>> = {
  ENOENT: 'notFound',
  EEXIST: 'alreadyExists',
  ENOTEMPTY: 'notEmpty',
  EACCES: 'permissionDenied',
  EPERM: 'permissionDenied',
  EISDIR: 'invalidPath',
  ENOTDIR: 'notDirectory',
  EINVAL: 'invalidPath',
  EXDEV: 'unsupported',
  ENOSPC: 'unknown',
  ETIMEDOUT: 'timeout',
  ECONNREFUSED: 'network',
  ECONNRESET: 'network',
  ECONNABORTED: 'network',
  ENOTFOUND: 'network',
  EAI_AGAIN: 'network',
  EHOSTUNREACH: 'network',
  ENETUNREACH: 'network',
  EPIPE: 'network',
  ERR_FS_CP_EEXIST: 'alreadyExists'
}

const HTTP_STATUS_MAP: Readonly<Record<number, FileErrorCode>> = {
  400: 'invalidPath',
  401: 'authFailed',
  403: 'permissionDenied',
  404: 'notFound',
  405: 'unsupported',
  409: 'alreadyExists',
  412: 'alreadyExists',
  423: 'permissionDenied',
  500: 'network',
  502: 'network',
  503: 'network',
  504: 'network',
  507: 'unknown'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 读取 unknown 上的一个属性；非对象或不存在返回 undefined */
function readProperty(source: unknown, key: string): unknown {
  return isRecord(source) ? source[key] : undefined
}

function isAbortError(error: unknown): boolean {
  const name = readProperty(error, 'name')
  return name === 'AbortError' || name === 'TimeoutError'
}

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : ''
}

export function toFileError(
  error: unknown,
  fallback: FileErrorCode,
  message?: string
): FileError {
  if (error instanceof FileError) return error
  if (isAbortError(error)) {
    return new FileError('cancelled', message ?? FILE_ERROR_MESSAGES.cancelled)
  }
  const code = readProperty(error, 'code')
  if (typeof code === 'string' && NODE_CODE_MAP[code]) {
    const mapped = NODE_CODE_MAP[code]
    return new FileError(mapped, message ?? (detailOf(error) || FILE_ERROR_MESSAGES[mapped]))
  }
  const status = readProperty(error, 'status')
  if (typeof status === 'number' && HTTP_STATUS_MAP[status]) {
    const mapped = HTTP_STATUS_MAP[status]
    return new FileError(mapped, message ?? (detailOf(error) || FILE_ERROR_MESSAGES[mapped]))
  }
  const detail = detailOf(error)
  return new FileError(fallback, message ?? (detail.length > 0 ? detail : FILE_ERROR_MESSAGES[fallback]))
}

/** 只有网络类与超时类错误值得重试（仅用于幂等的读操作） */
export function isRetryableFileError(error: unknown): boolean {
  if (error instanceof FileError) return error.code === 'network' || error.code === 'timeout'
  const code = readProperty(error, 'code')
  return typeof code === 'string' && (code === 'ETIMEDOUT' || code === 'ECONNRESET')
}

/** 判断错误是否为「文件不存在」，供 exists 一类操作吞掉 */
export function isNotFoundError(error: unknown): boolean {
  return toFileError(error, 'unknown').code === 'notFound'
}
