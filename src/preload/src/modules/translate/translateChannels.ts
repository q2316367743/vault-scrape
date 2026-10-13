/**
 * 翻译 IPC 通道定义。
 *
 * 契约：preload 桥与主进程 handler 共用这一份定义（主进程通过别名 `~` 引用），
 * 任意一侧改名都会在 typecheck 阶段暴露。
 *
 * 译文是**库内派生物**，通道只有「翻一个条目」与「丢掉一个条目的译文」两条；
 * 翻译插件自身的增删改查走 `plugin:translate:*`（插件管理页那套），本域不重复提供。
 */
export const TranslateChannels = {
  /** 翻译一个条目（影片 / 剧集 / 集）；剧集连同它的每一集一起翻 */
  item: 'translate:item',
  /** 丢掉一个条目的译文（详情页「清除译文」用） */
  clear: 'translate:clear'
} as const
