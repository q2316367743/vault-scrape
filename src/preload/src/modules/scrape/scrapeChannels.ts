/**
 * 刮削模块的 IPC 通道定义。
 *
 * 契约：preload 桥与主进程 handler 共用这一份定义（主进程通过别名 `~` 引用），
 * 任意一侧改名都会在 typecheck 阶段暴露。
 */
export const ScrapeChannels = {
  /** 扫描根目录（不递归）下的视频文件 */
  listVideos: 'scrape:listVideos',
  /** 启动任务，立即返回任务快照 */
  start: 'scrape:start',
  /** 取消任务（保留待刮削文件，可继续） */
  cancel: 'scrape:cancel',
  /** 继续被取消 / 中断的任务 */
  resume: 'scrape:resume',
  /** 读取任务快照与逐文件结果 */
  getTask: 'scrape:getTask',
  /** 最近的任务列表 */
  listTasks: 'scrape:listTasks',
  /** 主进程当前是否有任务在跑（窗口重开后据此恢复按钮状态） */
  running: 'scrape:running',
  /** 主进程 → 渲染层单向推送：任务快照 + 本次变化的文件 */
  progress: 'scrape:progress'
} as const
