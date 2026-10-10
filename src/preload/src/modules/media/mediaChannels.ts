/**
 * 影视墙 IPC 通道定义。
 *
 * 契约：preload 桥与主进程 handler 共用这一份定义（主进程通过别名 `~` 引用），
 * 任意一侧改名都会在 typecheck 阶段暴露。
 */
export const MediaChannels = {
  /** 拉取整面墙（所有数据源的视频 + 刮削补全结果；可按资料库过滤） */
  wall: 'media:wall',
  /** 首页读模型：库摘要 + 最近添加 / 推荐两排 */
  home: 'media:home',
  /** 单个视频的详情（含同目录 NFO 解析结果） */
  detail: 'media:detail'
} as const
