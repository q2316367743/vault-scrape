/**
 * 概览页与「刮削进度详情」页共用的展示口径。
 *
 * 契约：
 * - 任务状态、文件状态的文案与配色只在这里定义，任务卡片与结果表共用，避免多处硬编码；
 * - 进度百分比统一 `Math.min(100, round(finished / total * 100))`，`total` 为 0 时给 0；
 * - 时间戳统一 `YYYY-MM-DD HH:mm`，非正数给占位符「—」，避免 1970 字样。
 */
import dayjs from 'dayjs'
import type { ScrapeFileStatus } from '@common/types/scrape'
import type { TaskStatus } from '@common/types/task'

/** tdesign 支持的标签配色子集 */
export type StatusTheme = 'default' | 'primary' | 'warning' | 'success' | 'danger'

export const TASK_STATUS_LABELS: Readonly<Record<TaskStatus, string>> = {
  pending: '排队中',
  running: '刮削中',
  success: '已完成',
  failed: '有失败',
  paused: '已取消',
  interrupted: '已中断'
}

export const TASK_STATUS_THEMES: Readonly<Record<TaskStatus, StatusTheme>> = {
  pending: 'default',
  running: 'primary',
  success: 'success',
  failed: 'danger',
  paused: 'warning',
  interrupted: 'warning'
}

/** 逐文件结果的状态配色；文案直接用 `SCRAPE_FILE_STATUS_LABELS` */
export const SCRAPE_FILE_STATUS_THEMES: Readonly<Record<ScrapeFileStatus, StatusTheme>> = {
  pending: 'default',
  running: 'primary',
  success: 'success',
  failed: 'danger',
  skipped: 'default'
}

/** 毫秒时间戳 → `YYYY-MM-DD HH:mm`，无效值给占位符 */
export function formatTimestamp(value: number): string {
  return value > 0 ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—'
}

/** 任务进度百分比，用于进度条与记录表 */
export function toPercentage(finished: number, total: number): number {
  return total > 0 ? Math.min(100, Math.round((finished / total) * 100)) : 0
}
