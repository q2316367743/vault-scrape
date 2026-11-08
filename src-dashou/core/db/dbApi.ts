/**
 * 数据库域的 core API：日志与任务查询。
 *
 * 契约：handler 只做参数透传，SQL 全在 repo 内；返回值保持与旧 IPC 完全一致的形状。
 */
import type { LogQuery } from '@common/types/log'
import type { TaskQuery } from '@common/types/task'
import { clearLog, countLog, listLog } from '../db/repo/logRepo'
import { countTask, listTask, taskStats } from '../db/repo/taskRepo'

export const dbApi = {
  dbLogList: (_ctx: unknown, query: unknown): ReturnType<typeof listLog> =>
    listLog((query ?? {}) as LogQuery),

  dbLogCount: (_ctx: unknown, query: unknown): number =>
    countLog((query ?? {}) as LogQuery),

  dbLogClear: (): number => clearLog(),

  dbTaskList: (_ctx: unknown, query: unknown): ReturnType<typeof listTask> =>
    listTask((query ?? {}) as TaskQuery),

  dbTaskCount: (_ctx: unknown, query: unknown): number =>
    countTask((query ?? {}) as TaskQuery),

  dbTaskStats: (): ReturnType<typeof taskStats> => taskStats()
}
