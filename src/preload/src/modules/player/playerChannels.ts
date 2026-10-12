/**
 * 播放窗口 IPC 通道定义。
 *
 * 契约：preload 桥与主进程 handler 共用这一份定义（主进程通过别名 `~` 引用），
 * 任意一侧改名都会在 typecheck 阶段暴露。
 */
export const PlayerChannels = {
  /** 打开播放窗口（已有窗口就换片并聚焦） */
  open: 'player:open',
  /** 播放窗口就绪后拉取待播目标：拿到地址与后端 */
  load: 'player:load',
  /** 播放控制命令（播放/暂停、进度、音量、倍速） */
  command: 'player:command',
  /** 关闭播放窗口 */
  close: 'player:close',
  /** 检测 mpv 可执行文件（设置页「检测」按钮） */
  detect: 'player:detect',
  /** 拉一次播放状态快照（主窗口标题栏挂载 / 重载时补齐初值） */
  snapshot: 'player:snapshot',
  /** 聚焦播放窗口（主窗口标题栏点「正在播放」标签） */
  focus: 'player:focus',
  /** 主进程 → 播放窗口：窗口已存在时换片 */
  switch: 'player:switch',
  /** 主进程 → 播放窗口：播放状态推送（200ms 节流） */
  state: 'player:state',
  /** 主进程 → 播放窗口：布局状态（全屏时收起侧栏与控制条） */
  layout: 'player:layout',
  /** 主进程 → 所有窗口：播放状态快照（主窗口标题栏的「正在播放」标签） */
  status: 'player:status'
} as const
