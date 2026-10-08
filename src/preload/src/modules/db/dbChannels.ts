/**
 * db 域 IPC 契约：通道常量。
 * preload 桥与 main handler 共用这一份定义（main 通过别名 ~ 引用）。
 */
export const DbChannels = {
  logList: 'db:logList',
  logCount: 'db:logCount',
  logClear: 'db:logClear',
  taskList: 'db:taskList',
  taskCount: 'db:taskCount',
  taskStats: 'db:taskStats'
} as const
