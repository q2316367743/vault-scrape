/**
 * 手动匹配的公共形状。
 *
 * 契约：
 * - 请求由渲染层给出「条目 + 用户选中的插件与候选 ID」，所属资料库、数据源、目录一律由主进程按条目反查，
 *   渲染层不参与流水线口径；
 * - 手动匹配**就是一条刮削任务**（落 `task` / `scrape_file`，广播 `scrape:progress`），只是条目只有一条、
 *   并且带「强制候选」；因此结果只回任务 ID，进度与逐文件结果走刮削任务那一套（`scrape:getTask` /
 *   `scrape:progress` / 概览页的刮削记录），渲染层拿到后跳进度详情页即可，**不要在这里等流水线跑完**；
 * - 主进程按条目类型分派到影片或剧集流水线，调用方不需要区分。
 */

/** 手动匹配请求 */
export interface ScrapeMatchRequest {
  /** 媒体条目 ID（`media_item.id`） */
  itemId: string
  /** 选中的刮削插件：必须在该条目所属资料库的 `scrapers` 里且当前可用 */
  pluginId: string
  /** 选中的候选 ID：search 给的带类型前缀 id，或 detail 返回的纯数字 id */
  movieId: string
}

/** 手动匹配结果：立即返回，表示「任务已建好并开始跑」 */
export interface ScrapeMatchResult {
  /** 媒体条目 ID */
  itemId: string
  /** 新建的刮削任务 ID：进 `/overview/scrape?taskId=…` 看进度与逐文件结果 */
  taskId: string
}
