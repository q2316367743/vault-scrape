/**
 * 刮削任务的公共形状。
 *
 * 契约：
 * - 任务与逐文件结果都以 sqlite 为准（`task` / `scrape_file` 表），
 *   内存态只用于运行中的并发调度，渲染层重挂载后从主进程重新拉快照；
 * - 逐文件结果挂在**条目**上（`itemId`），刮削产物写回 `media_item` 与 `media_image`；
 * - 进度事件是「增量提示」，不是唯一真相。
 */
import type { TaskItem } from '../task'

/** 单文件刮削状态 */
export type ScrapeFileStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped'

export const SCRAPE_FILE_STATUSES: readonly ScrapeFileStatus[] = [
  'pending',
  'running',
  'success',
  'failed',
  'skipped'
]

export const SCRAPE_FILE_STATUS_LABELS: Readonly<Record<ScrapeFileStatus, string>> = {
  pending: '待刮削',
  running: '刮削中',
  success: '已完成',
  failed: '失败',
  skipped: '已跳过'
}

/** 一条逐文件刮削记录（对应 scrape_file 表一行） */
export interface ScrapeFileItem {
  id: string
  taskId: string
  /** 本次刮削的条目 ID（`media_item.id`）；解析不到条目时为空串 */
  itemId: string
  /** 扫描时的原始路径，任务内唯一 */
  path: string
  /** 刮削结束后的最终路径：未开启改名/移动时与 `path` 相同 */
  finalPath: string
  name: string
  /** 文件名解析出的搜索关键词 */
  keyword: string
  status: ScrapeFileStatus
  /** 最终命中的插件 ID，未命中为空串 */
  pluginId: string
  /** 插件标题，未命中为空串 */
  title: string
  /** 结果说明（含失败原因或重命名后的新路径） */
  message: string
  updatedAt: number
}

/** 任务快照：任务行本身已经包含连接、目录与失败计数 */
export type ScrapeTaskSnapshot = TaskItem

/** 从资料库里挑出来的一个待刮削条目 */
export interface ScrapeScanEntry {
  /** 条目 ID（`media_item.id`） */
  itemId: string
  path: string
  name: string
  size: number
  modifiedAt: number
  /** 解析出的搜索关键词 */
  keyword: string
  /** 解析出的番号，未识别为空串 */
  num: string
  /** 与同目录内另一个文件同番号时，指向先出现的那个路径 */
  duplicateOf?: string
}

/** 浏览资料库某层目录 */
export interface ScrapeBrowseRequest {
  libraryId: string
  /** 连接内目录路径，`/` 表示连接根 */
  dirPath: string
}

/** 启动刮削任务：由资料库自己的刮削器执行 */
export interface ScrapeStartRequest {
  libraryId: string
  /** 待刮削条目 ID 列表 */
  itemIds: string[]
}

/** 针对已有任务的操作 */
export interface ScrapeTaskRequest {
  taskId: string
}

/** 进度事件：任务快照 + 本次变化的文件 */
export interface ScrapeProgressEvent {
  task: ScrapeTaskSnapshot
  file: ScrapeFileItem
}
