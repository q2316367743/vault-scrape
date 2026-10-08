import { ipcMain } from 'electron'
import { DbChannels } from '~/modules/db/dbChannels'
import type { LogQuery } from '@common/types/log'
import type { TaskQuery } from '@common/types/task'
import { initDb } from './client'
import { clearLog, countLog, listLog } from './repo/logRepo'
import { countTask, listTask, taskStats } from './repo/taskRepo'

/** db 域 IPC 注册：handler 只做参数透传，SQL 全在 repo 内 */
export function registerDbIpc(): void {
  initDb()
  ipcMain.handle(DbChannels.logList, (_event, query?: LogQuery) => listLog(query))
  ipcMain.handle(DbChannels.logCount, (_event, query?: LogQuery) => countLog(query))
  ipcMain.handle(DbChannels.logClear, () => clearLog())
  ipcMain.handle(DbChannels.taskList, (_event, query?: TaskQuery) => listTask(query))
  ipcMain.handle(DbChannels.taskCount, (_event, query?: TaskQuery) => countTask(query))
  ipcMain.handle(DbChannels.taskStats, () => taskStats())
}
