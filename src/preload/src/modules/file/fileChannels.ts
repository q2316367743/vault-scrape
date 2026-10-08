/**
 * 文件模块的 IPC 通道定义。
 *
 * preload 桥与 main handler 共用这一份定义（main 通过别名 ~ 引用）。
 */
export const FileChannels = {
  listConnections: 'file:listConnections',
  saveConnection: 'file:saveConnection',
  deleteConnection: 'file:deleteConnection',
  testConnection: 'file:testConnection',
  disposeConnection: 'file:disposeConnection',
  list: 'file:list',
  stat: 'file:stat',
  exists: 'file:exists',
  mkdir: 'file:mkdir',
  createFile: 'file:createFile',
  readText: 'file:readText',
  writeText: 'file:writeText',
  move: 'file:move',
  copy: 'file:copy',
  remove: 'file:remove',
  upload: 'file:upload',
  download: 'file:download',
  cancelTransfer: 'file:cancelTransfer',
  /** main → renderer 单向推送：传输进度 */
  transferProgress: 'file:transferProgress',
  /** main → renderer 单向推送：传输结束（成功或失败） */
  transferDone: 'file:transferDone'
} as const
