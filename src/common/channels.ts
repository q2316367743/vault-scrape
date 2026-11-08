/**
 * core → 窗口的事件名（宿主事件总线）。
 *
 * 契约：
 * - core 用 `ctx.event.emit(name, payload)` 广播 / `emitTo(label, name, payload)` 定向；
 * - 窗口用 `@dashou/api/event` 的 `listen(name, handler)` 订阅；
 * - 事件名在 core 与窗口两侧必须完全一致，所以集中在本文件，禁止在业务代码里手写字符串。
 */
export const CORE_EVENTS = {
  /** 演员资料补全队列进度 */
  actorProgress: 'actor:progress',
  /** 文件传输进度 / 结束 */
  fileTransferProgress: 'file:transferProgress',
  fileTransferDone: 'file:transferDone',
  /** 资料库扫描进度 */
  libraryProgress: 'library:progress',
  /** 离线数据包：进度 / 结束 / 上游有新包 */
  offlineProgress: 'offline:progress',
  offlineDone: 'offline:done',
  offlineUpdateAvailable: 'offline:updateAvailable',
  /** 播放窗口：换片 / 播放状态 / 布局 / 给所有窗口的状态快照 */
  playerSwitch: 'player:switch',
  playerState: 'player:state',
  playerLayout: 'player:layout',
  playerStatus: 'player:status',
  /** 刮削任务进度 */
  scrapeProgress: 'scrape:progress',
  /** 长任务（可能超过 30s 的 API 调用）统一结果事件 */
  jobDone: 'core:job:done'
} as const
