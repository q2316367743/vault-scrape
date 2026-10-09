/**
 * 工作台（刮削）的展示工具：状态配色、路径换算、时间格式化。
 *
 * 契约：
 * - 状态文案与配色只在这里定义，表格与任务卡片共用，避免多处硬编码；
 * - 「数据源根目录」在连接内统一用 `/` 表达；本地连接要把用户选的本机目录换算成连接内路径，
 *   换算规则与主进程 `impl/local/localPath.ts` 的 `toRemotePath` 保持一致（最长前缀匹配）。
 * - NSFW 的生效判定不在本文件：见 `@/hooks/UseNsfwProtection.ts`。
 */
import dayjs from 'dayjs'
import { FILE_ROOT, normalizeRemotePath, type FileConnection } from '@common/types/file'
import type { ScrapeFileStatus } from '@common/types/scrape'
import type { TaskStatus } from '@common/types/task'

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

/** 去掉结尾分隔符，统一成正斜杠 */
function trimTrailingSlash(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** 用户在本机选中的绝对目录 → 连接内路径（本地数据源） */
export function toRemoteDir(connection: FileConnection | null, localPath: string): string {
  const picked = trimTrailingSlash(localPath.trim())
  if (picked.length === 0) return FILE_ROOT
  if (!connection || connection.protocol !== 'local') return normalizeRemotePath(picked)
  const root = trimTrailingSlash(connection.rootPath)
  if (root.length === 0) return normalizeRemotePath(picked)
  if (picked === root) return FILE_ROOT
  if (picked.startsWith(`${root}/`)) return normalizeRemotePath(picked.slice(root.length))
  /** 不在数据源根目录下：原样当连接内路径交给主进程判定 */
  return normalizeRemotePath(picked)
}

/** 连接内路径 → 便于用户确认的本机路径（仅本地数据源） */
export function toDisplayDir(connection: FileConnection | null, dirPath: string): string {
  const normalized = normalizeRemotePath(dirPath)
  if (!connection || connection.protocol !== 'local') return normalized
  const root = trimTrailingSlash(connection.rootPath)
  if (root.length === 0) return normalized
  return normalized === FILE_ROOT ? root : `${root}${normalized}`
}

/** 毫秒时间戳 → `YYYY-MM-DD HH:mm`，无效值给占位符 */
export function formatTimestamp(value: number): string {
  return value > 0 ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—'
}
