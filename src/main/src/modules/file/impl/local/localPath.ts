import { relative, resolve, sep } from 'path'
import { FILE_ROOT, FileError, normalizeRemotePath } from '@common/types/file'

/**
 * 本地磁盘的路径换算。
 *
 * 越界防护：连接内路径先归一化（`..` 越根会抛 invalidPath），再拼到根目录下，
 * 最后用 startsWith(root + sep) 复核一次，杜绝绝对路径或符号拼接逃逸。
 * 已知限制：本实现不解析符号链接，根目录内的软链接可以指向根外。
 */
export function resolveInsideRoot(rootPath: string, remotePath: string): string {
  const normalized = normalizeRemotePath(remotePath)
  const root = resolve(rootPath)
  const target = normalized === FILE_ROOT ? root : resolve(root, `.${normalized}`)
  if (target === root) return target
  if (!target.startsWith(root + sep)) {
    throw new FileError('invalidPath', `路径越出本地根目录：${remotePath}`)
  }
  return target
}

/** 把本机绝对路径还原成连接内路径 */
export function toRemotePath(rootPath: string, localPath: string): string {
  const rel = relative(resolve(rootPath), localPath)
  if (rel === '') return FILE_ROOT
  return normalizeRemotePath(rel)
}
