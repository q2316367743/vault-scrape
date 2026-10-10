/**
 * 文件模块的统一路径工具（纯字符串实现，不依赖 node:path）。
 *
 * 统一语义：连接根为 `/`，分隔符一律为正斜杠。
 * 归一化会折叠重复斜杠、解析 `.` 与 `..`；`..` 越出根目录时抛 invalidPath。
 */
import { FileError } from './error'

export const FILE_ROOT = '/'

export function normalizeRemotePath(input: string): string {
  const segments = input.replace(/\\/g, '/').split('/')
  const result: string[] = []
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (result.length === 0) {
        throw new FileError('invalidPath', `路径越出连接根目录：${input}`)
      }
      result.pop()
      continue
    }
    result.push(segment)
  }
  return result.length === 0 ? FILE_ROOT : `${FILE_ROOT}${result.join('/')}`
}

export function joinRemotePath(...parts: string[]): string {
  return normalizeRemotePath(parts.join('/'))
}

export function isFileRoot(path: string): boolean {
  return normalizeRemotePath(path) === FILE_ROOT
}

export function basenameRemotePath(path: string): string {
  const normalized = normalizeRemotePath(path)
  if (normalized === FILE_ROOT) return ''
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

export function dirnameRemotePath(path: string): string {
  const normalized = normalizeRemotePath(path)
  if (normalized === FILE_ROOT) return FILE_ROOT
  const index = normalized.lastIndexOf('/')
  return index <= 0 ? FILE_ROOT : normalized.slice(0, index)
}

/**
 * `path` 是否位于 `dir` 之下（含 `dir` 自身）。
 * `dir` 为连接根时恒为 true；用于「跳过某目录时不要清理其下数据」这类前缀判断。
 */
export function isRemotePathInside(dir: string, path: string): boolean {
  const base = normalizeRemotePath(dir)
  const target = normalizeRemotePath(path)
  if (base === FILE_ROOT) return true
  return target === base || target.startsWith(`${base}/`)
}

/** 小写扩展名，不含点；无扩展名或点开头（.gitignore）返回空串 */
export function extnameOf(name: string): string {
  const index = name.lastIndexOf('.')
  if (index <= 0 || index === name.length - 1) return ''
  return name.slice(index + 1).toLowerCase()
}

/** 把路径拆成非空段，供 SMB 逐级建目录使用 */
export function splitRemotePath(path: string): string[] {
  const normalized = normalizeRemotePath(path)
  if (normalized === FILE_ROOT) return []
  return normalized.slice(1).split('/')
}
