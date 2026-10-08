import { FILE_ERROR_MESSAGES, FileError, type FileErrorCode } from '@common/types/file'
import { toFileError } from '../../fileErrorUtils'

/**
 * @awo00/smb2 的错误收敛。
 *
 * 该库有两类失败：
 * 1. 服务端返回非成功状态时 reject 的是 Response 对象（`response.header.status` 是数字）；
 *    库自带的 StatusCode 枚举只有 6 个值，其余 NT 状态码在这里补齐。
 * 2. 连接层直接抛 Error，message 为 `connect_timeout` / `not_connected` / `request_timeout: ...`。
 */
const NT_STATUS_MAP: Readonly<Record<number, FileErrorCode>> = {
  0xc0000034: 'notFound', // FILE_NAME_NOT_FOUND
  0xc000003a: 'notFound', // FILE_PATH_NOT_FOUND
  0xc000000f: 'notFound', // NO_SUCH_FILE
  0xc0000035: 'alreadyExists', // OBJECT_NAME_COLLISION
  0xc0000022: 'permissionDenied', // ACCESS_DENIED
  0xc0000101: 'notEmpty', // DIRECTORY_NOT_EMPTY
  0xc0000008: 'invalidPath', // INVALID_HANDLE
  0xc000000d: 'invalidPath', // INVALID_PARAMETER
  0xc000006d: 'authFailed', // LOGON_FAILURE
  0xc000006e: 'authFailed', // ACCOUNT_RESTRICTION
  0xc0000072: 'permissionDenied', // ACCOUNT_DISABLED
  0xc0000234: 'authFailed' // ACCOUNT_LOCKED_OUT
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 读取被 reject 的 Response 上的 header.status */
export function readSmbStatus(error: unknown): number | null {
  if (!isRecord(error)) return null
  const header = error.header
  if (!isRecord(header)) return null
  const status = header.status
  return typeof status === 'number' ? status : null
}

function hex(status: number): string {
  return `0x${status.toString(16).toUpperCase().padStart(8, '0')}`
}

export function toSmbError(error: unknown, fallback: FileErrorCode): FileError {
  if (error instanceof FileError) return error

  const status = readSmbStatus(error)
  if (status !== null) {
    const mapped = NT_STATUS_MAP[status]
    if (mapped) return new FileError(mapped, `SMB 操作失败（${hex(status)}）：${FILE_ERROR_MESSAGES[mapped]}`)
    return new FileError(fallback, `SMB 操作失败（NT 状态码 ${hex(status)}）`)
  }

  if (error instanceof Error) {
    if (error.message === 'connect_timeout') return new FileError('timeout', '连接 SMB 服务超时')
    if (error.message === 'not_connected') return new FileError('network', 'SMB 会话尚未连接')
    if (error.message.startsWith('request_timeout')) {
      return new FileError('timeout', 'SMB 请求超时（可能是服务端无响应或请求体过大）')
    }
  }

  return toFileError(error, fallback)
}
