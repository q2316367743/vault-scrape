/**
 * 离线数据包的状态快照与更新检查结果。
 *
 * 契约：
 * - 离线库是独立文件 `~/.vault-scrape/db/r18.db`，与系统库 `vault-scrape.db` 并列存放、
 *   互不 ATTACH；它损坏或被删除只影响离线刮削，系统数据照常；
 * - 状态里的「检查时间」等运行时信息落在同目录的 `r18-state.json`，
 *   这样库不存在时也能维持「最多每 7 天检查一次」的节奏。
 */

/** 数据包日期格式：YYYY-MM-DD */
export type OfflinePackDate = string

/** 渲染层可见的离线数据包状态 */
export interface OfflinePackStatus {
  /** 是否已安装数据包（库文件存在且能读出元数据） */
  installed: boolean
  /** 本地数据包日期，未安装为空串 */
  packDate: OfflinePackDate
  /** 导入完成时间戳（毫秒），未安装为 0 */
  importedAt: number
  /** 影片条目数（derived_video 行数） */
  videoCount: number
  /** 库文件体积（字节） */
  dbBytes: number
  /** 数据来源 URL，未安装为空串 */
  sourceUrl: string
  /** 库文件绝对路径（用于界面展示） */
  dbPath: string
  /** 最近一次成功检查更新的时间戳（毫秒），0 表示从未检查 */
  lastCheckAt: number
  /** 上游最新数据包日期，未知为空串 */
  latestPackDate: OfflinePackDate
  /** 上游是否有比本地更新的数据包 */
  updateAvailable: boolean
  /** 本地库存在但无法打开（损坏） */
  corrupt: boolean
}

/** 一次更新检查的结果 */
export interface OfflineCheckResult {
  /** 上游最新数据包日期 */
  latestPackDate: OfflinePackDate
  /** 上游文件名，如 r18dotdev_dump_2026-10-06.sql.gz */
  fileName: string
  /** 上游下载地址（重定向后的绝对地址） */
  url: string
  /** 相对本地数据包是否有更新 */
  updateAvailable: boolean
}
