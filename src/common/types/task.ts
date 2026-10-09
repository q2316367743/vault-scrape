/** 任务状态：paused=用户取消可继续，interrupted=应用重启导致中断 */
export type TaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'paused' | 'interrupted'

export const TASK_STATUSES: readonly TaskStatus[] = [
  'pending',
  'running',
  'success',
  'failed',
  'paused',
  'interrupted'
]

/** 一条刮削任务（对应 task 表一行） */
export interface TaskItem {
  id: string
  /** 任务名，通常是待刮削目录名或番号 */
  name: string
  status: TaskStatus
  /** 发起任务的数据源 */
  connectionId: string
  /** 扫描根目录（连接内路径） */
  dirPath: string
  /** 计划处理数量 */
  total: number
  /** 已处理数量 */
  finished: number
  /** 失败文件数 */
  failed: number
  /** 结果说明或失败原因 */
  message: string
  /** 毫秒时间戳 */
  createdAt: number
  /** 毫秒时间戳 */
  updatedAt: number
}

/** 任务查询条件 */
export interface TaskQuery {
  status?: TaskStatus
  offset?: number
  limit?: number
}

/** 概览统计 */
export interface TaskStats {
  total: number
  pending: number
  running: number
  success: number
  failed: number
  paused: number
  interrupted: number
}
