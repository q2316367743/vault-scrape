/**
 * setting 域 IPC 契约：通道常量。
 * preload 桥与 main handler 共用这一份定义（main 通过别名 ~ 引用）。
 */
export const SettingChannels = {
  getAll: 'setting:getAll',
  getGroup: 'setting:getGroup',
  saveGroup: 'setting:saveGroup'
} as const
