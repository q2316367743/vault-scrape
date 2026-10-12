/**
 * 手动匹配的公共形状。
 *
 * 契约：
 * - 请求由渲染层给出「条目 + 用户选中的插件与候选 ID」，所属资料库、数据源、目录一律由主进程按条目反查，
 *   渲染层不参与流水线口径；
 * - 结果与逐文件刮削结果同形（状态 / 标题 / 提示 / 最终路径），但**不落任务表**：手动匹配是单条即时执行；
 * - 主进程按条目类型分派到影片或剧集流水线，调用方不需要区分。
 */
import type { ScrapeFileStatus } from './task'

/** 手动匹配请求 */
export interface ScrapeMatchRequest {
  /** 媒体条目 ID（`media_item.id`） */
  itemId: string
  /** 选中的刮削插件：必须在该条目所属资料库的 `scrapers` 里且当前可用 */
  pluginId: string
  /** 选中的候选 ID：search 给的带类型前缀 id，或 detail 返回的纯数字 id */
  movieId: string
}

/** 手动匹配结果 */
export interface ScrapeMatchResult {
  itemId: string
  status: ScrapeFileStatus
  /** 实际产出元数据的插件 ID */
  pluginId: string
  /** 元数据标题 */
  title: string
  /** 中文结果提示（成功是产物摘要，失败是原因） */
  message: string
  /** 刮削结束后的视频路径（失败时为原路径） */
  finalPath: string
}
