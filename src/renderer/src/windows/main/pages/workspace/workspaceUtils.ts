/**
 * 工作台（刮削）的展示工具：状态配色、路径换算、时间格式化。
 *
 * 契约：
 * - 状态文案与配色只在这里定义，表格与任务卡片共用，避免多处硬编码；
 * - 「本机路径 ↔ 连接内路径」的换算已抽到公共工具 `@/utils/remotePath`（资料库表单同样在用），
 *   本文件原样转出，工作台内部引用无需改动；
 * - NSFW 的生效判定不在本文件：见 `@/hooks/UseNsfwProtection.ts`。
 */
import dayjs from 'dayjs'
import type { ScrapeFileStatus } from '@common/types/scrape'
import type { TaskStatus } from '@common/types/task'

export { toDisplayDir, toRemoteDir } from '@/utils/remotePath'

/** 表格里的行状态：`idle` 表示只扫描到、还没进任务 */
export type WorkspaceRowStatus = ScrapeFileStatus | 'idle'

export const WORKSPACE_STATUS_LABELS: Readonly<Record<WorkspaceRowStatus, string>> = {
  idle: '未开始',
  pending: '待刮削',
  running: '刮削中',
  success: '已完成',
  failed: '失败',
  skipped: '已跳过'
}

export const WORKSPACE_STATUS_THEMES: Readonly<
  Record<WorkspaceRowStatus, 'default' | 'primary' | 'warning' | 'success' | 'danger'>
> = {
  idle: 'default',
  pending: 'primary',
  running: 'warning',
  success: 'success',
  failed: 'danger',
  skipped: 'default'
}

export const TASK_STATUS_LABELS: Readonly<Record<TaskStatus, string>> = {
  pending: '排队中',
  running: '刮削中',
  success: '已完成',
  failed: '有失败',
  paused: '已取消',
  interrupted: '已中断'
}

export const TASK_STATUS_THEMES: Readonly<
  Record<TaskStatus, 'default' | 'primary' | 'warning' | 'success' | 'danger'>
> = {
  pending: 'default',
  running: 'primary',
  success: 'success',
  failed: 'danger',
  paused: 'warning',
  interrupted: 'warning'
}

/** 毫秒时间戳 → `YYYY-MM-DD HH:mm`，无效值给占位符 */
export function formatTimestamp(value: number): string {
  return value > 0 ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—'
}
