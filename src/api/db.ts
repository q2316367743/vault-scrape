/**
 * 渲染层访问日志与任务的统一出口。
 */
import type { LogItem, LogQuery } from '@common/types/log'
import type { TaskItem, TaskQuery, TaskStats } from '@common/types/task'
import { callCore } from './invoke'

export const dbApi = {
  log: {
    list: (query?: LogQuery): Promise<LogItem[]> => callCore('dbLogList', query),
    count: (query?: LogQuery): Promise<number> => callCore('dbLogCount', query),
    clear: (): Promise<number> => callCore('dbLogClear')
  },
  task: {
    list: (query?: TaskQuery): Promise<TaskItem[]> => callCore('dbTaskList', query),
    count: (query?: TaskQuery): Promise<number> => callCore('dbTaskCount', query),
    stats: (): Promise<TaskStats> => callCore('dbTaskStats')
  }
}

export type DbApi = typeof dbApi
