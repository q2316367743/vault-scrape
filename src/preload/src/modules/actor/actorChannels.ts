/**
 * 演员模块 IPC 通道定义。
 *
 * 契约：preload 桥与主进程 handler 共用这一份定义（主进程通过别名 `~` 引用），
 * 任意一侧改名都会在 typecheck 阶段暴露。
 */
export const ActorChannels = {
  /** 演员列表（关键词 / 标签筛选 + 分页 + 排序） */
  list: 'actor:list',
  /** 演员详情（含该演员全部出演作品） */
  detail: 'actor:detail',
  /** 新增或更新演员的用户设定数据 */
  save: 'actor:save',
  /** 删除演员（连带图集文件） */
  remove: 'actor:remove',
  /** 导入本机图片到演员图集 / 头像 */
  importImages: 'actor:importImages',
  /** 删除一张演员图片 */
  removeImage: 'actor:removeImage',
  /** 把已有图片设为头像 */
  setAvatar: 'actor:setAvatar',
  /** 抓取一位演员的资料与图片 */
  scrape: 'actor:scrape',
  /** 批量抓取资料不全的演员（进后台队列） */
  scrapeMissing: 'actor:scrapeMissing'
} as const
