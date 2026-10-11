/**
 * 演员模块的错误码与错误类型（与影视墙 / 刮削域同款写法）。
 *
 * 契约：
 * - 实现内部抛 `ActorError`，只有 IPC 边界把它转成 `ActorResult` 信封；
 * - 「没有头像」「抓取没有命中」不是错误，用空值表达；
 * - 渲染层只按 `code` 做逻辑判断，不解析 message。
 */
export type ActorErrorCode =
  | 'notFound'
  | 'invalidArgument'
  | 'conflict'
  | 'ioFailed'
  | 'scrapeFailed'
  | 'cancelled'
  | 'unknown'

export const ACTOR_ERROR_CODES: readonly ActorErrorCode[] = [
  'notFound',
  'invalidArgument',
  'conflict',
  'ioFailed',
  'scrapeFailed',
  'cancelled',
  'unknown'
]

export const ACTOR_ERROR_MESSAGES: Readonly<Record<ActorErrorCode, string>> = {
  notFound: '没有找到这个演员，可能已被删除',
  invalidArgument: '参数不合法',
  conflict: '同名演员已存在',
  ioFailed: '图片读写失败',
  scrapeFailed: '抓取演员资料失败',
  cancelled: '操作已取消',
  unknown: '未知错误'
}

export class ActorError extends Error {
  readonly code: ActorErrorCode

  constructor(code: ActorErrorCode, message?: string) {
    super(message ?? ACTOR_ERROR_MESSAGES[code])
    this.name = 'ActorError'
    this.code = code
  }
}

/** 把任意异常收敛成错误码 + 中文文案，供 IPC 边界使用 */
export function describeActorError(error: unknown): { code: ActorErrorCode; message: string } {
  if (error instanceof ActorError) return { code: error.code, message: error.message }
  if (error instanceof Error) {
    return { code: 'unknown', message: error.message || ACTOR_ERROR_MESSAGES.unknown }
  }
  return { code: 'unknown', message: ACTOR_ERROR_MESSAGES.unknown }
}
