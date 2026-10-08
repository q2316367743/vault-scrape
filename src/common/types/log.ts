/** 日志级别 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error']

/** 一条日志（对应 log 表一行） */
export interface LogItem {
  id: string
  level: LogLevel
  /** 产生日志的模块，如 app / setting */
  scope: string
  message: string
  /** 附加信息，通常是 JSON 字符串，空串表示无 */
  detail: string
  /** 毫秒时间戳 */
  createdAt: number
}

/** 日志查询条件 */
export interface LogQuery {
  level?: LogLevel
  offset?: number
  limit?: number
}

/** 写入日志的入参（id 与时间由主进程补全） */
export interface LogInput {
  level: LogLevel
  scope: string
  message: string
  detail?: string
}
