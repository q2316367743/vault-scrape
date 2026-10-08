/**
 * plugin 域 IPC 契约：通道常量。
 * preload 桥与 main handler 共用这一份定义（main 通过别名 ~ 引用）。
 */
export const PluginChannels = {
  list: 'plugin:list',
  readCode: 'plugin:readCode',
  saveCode: 'plugin:saveCode',
  import: 'plugin:import',
  remove: 'plugin:remove',
  setEnabled: 'plugin:setEnabled',
  getEnv: 'plugin:getEnv',
  saveEnv: 'plugin:saveEnv',
  invoke: 'plugin:invoke'
} as const
