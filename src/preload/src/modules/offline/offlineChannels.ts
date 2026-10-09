/**
 * 离线数据包域的 IPC 通道。
 *
 * 契约：preload 桥与主进程 handler 共用这一份定义（主进程通过别名 `~` 引用），
 * 任意一侧改名都会在 typecheck 阶段暴露。
 */
export const OfflineChannels = {
  /** 读取状态快照 */
  status: 'offline:status',
  /** 主动检查更新（不下载） */
  check: 'offline:check',
  /** 开始「下载并导入」，立即返回 jobId */
  update: 'offline:update',
  /** 从本地文件导入（主进程弹选择框），立即返回 jobId */
  importLocal: 'offline:importLocal',
  /** 取消当前任务 */
  cancel: 'offline:cancel',
  /** 删除已安装的离线数据包 */
  remove: 'offline:remove',
  /** 主进程 → 渲染层：进度 */
  progress: 'offline:progress',
  /** 主进程 → 渲染层：任务结束 */
  done: 'offline:done',
  /** 主进程 → 渲染层：上游有新数据包（自动检查命中） */
  updateAvailable: 'offline:updateAvailable'
} as const
