/**
 * 影视墙（媒体库）的错误码与错误类型。
 *
 * 契约（与刮削域同款）：
 * - 实现内部抛 `MediaError`，只有 IPC 边界把它转换成 `MediaResult` 信封；
 * - 每个错误码都有中文文案，渲染层只按 `code` 做逻辑判断，不解析 message；
 * - 「读不到 NFO」「连接已删除」这类可降级情况**不抛错**，只返回空 meta。
 */
export type MediaErrorCode = 'notFound' | 'invalidArgument' | 'readFailed' | 'unknown'

export const MEDIA_ERROR_CODES: readonly MediaErrorCode[] = [
  'notFound',
  'invalidArgument',
  'readFailed',
  'unknown'
]

export const MEDIA_ERROR_MESSAGES: Readonly<Record<MediaErrorCode, string>> = {
  notFound: '索引里没有这个视频，磁盘上可能已被删除',
  invalidArgument: '参数不合法',
  readFailed: '读取文件失败',
  unknown: '未知错误'
}

/** 影视墙统一错误：带错误码，message 一律为中文 */
export class MediaError extends Error {
  readonly code: MediaErrorCode

  constructor(code: MediaErrorCode, message?: string) {
    super(message ?? MEDIA_ERROR_MESSAGES[code])
    this.name = 'MediaError'
    this.code = code
  }
}

/** 把任意异常收敛成错误码 + 中文文案，供 IPC 边界使用 */
export function describeMediaError(error: unknown): { code: MediaErrorCode; message: string } {
  if (error instanceof MediaError) return { code: error.code, message: error.message }
  if (error instanceof Error) {
    return { code: 'unknown', message: error.message || MEDIA_ERROR_MESSAGES.unknown }
  }
  return { code: 'unknown', message: MEDIA_ERROR_MESSAGES.unknown }
}
