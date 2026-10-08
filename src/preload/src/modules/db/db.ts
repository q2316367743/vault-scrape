import { ipcRenderer } from 'electron'
import type { LogItem, LogQuery } from '@common/types/log'
import type { TaskItem, TaskQuery, TaskStats } from '@common/types/task'
import { DbChannels } from './dbChannels'

/** 渲染层访问数据库的唯一入口：全部是 IPC 薄封装 */
export const dbApi = {
  log: {
    list: (query?: LogQuery): Promise<LogItem[]> => ipcRenderer.invoke(DbChannels.logList, query),
    count: (query?: LogQuery): Promise<number> => ipcRenderer.invoke(DbChannels.logCount, query),
    clear: (): Promise<number> => ipcRenderer.invoke(DbChannels.logClear)
  },
  task: {
    list: (query?: TaskQuery): Promise<TaskItem[]> =>
      ipcRenderer.invoke(DbChannels.taskList, query),
    count: (query?: TaskQuery): Promise<number> =>
      ipcRenderer.invoke(DbChannels.taskCount, query),
    stats: (): Promise<TaskStats> => ipcRenderer.invoke(DbChannels.taskStats)
  }
}

export type DbApi = typeof dbApi
