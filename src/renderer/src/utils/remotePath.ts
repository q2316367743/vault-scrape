/**
 * 「本机绝对路径 ↔ 连接内路径」的换算。
 *
 * 契约（工作台与资料库共用同一套规则，避免两处口径漂移）：
 * - 连接内路径统一用 `/` 表达，结尾不带分隔符；
 * - 只有本地数据源需要换算：`connection.rootPath` 是本机根目录，连接内 `/` 对应它；
 * - 换算规则与主进程 `impl/local/localPath.ts` 的 `toRemotePath` 保持一致（最长前缀匹配）；
 * - 选中的本机目录不在数据源根目录下时，原样当连接内路径交给主进程判定（由主进程报错）。
 */
import { FILE_ROOT, normalizeRemotePath, type FileConnection } from '@common/types/file'

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
