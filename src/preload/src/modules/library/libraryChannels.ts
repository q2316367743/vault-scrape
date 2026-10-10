/**
 * 资料库模块的 IPC 通道定义。
 *
 * 契约：preload 桥与主进程 handler 共用这一份定义（主进程通过别名 `~` 引用），
 * 任意一侧改名都会在 typecheck 阶段暴露。
 */
export const LibraryChannels = {
  /** 列出全部资料库 */
  list: 'library:list',
  /** 新建或更新资料库 */
  save: 'library:save',
  /** 删除资料库（只删配置） */
  remove: 'library:remove',
  /** 递归扫描资料库（长任务，返回最终结果，期间用 progress 事件推进度） */
  scan: 'library:scan',
  /** 取消正在进行的扫描 */
  cancelScan: 'library:cancelScan',
  /** 刮削已扫描但尚未刮削的影视 */
  scrape: 'library:scrape',
  /** 主进程当前是否有扫描在跑（窗口重开后据此恢复按钮状态） */
  running: 'library:running',
  /** 主进程 → 渲染层单向推送：扫描进度 */
  progress: 'library:progress'
} as const
