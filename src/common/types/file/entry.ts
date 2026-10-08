/**
 * 文件条目：三种协议（本地 / WebDAV / SMB）归一后的统一形状。
 *
 * 契约：不可得的字段用空串或 0 表示，不用 undefined，避免渲染层到处判空。
 */
import { basenameRemotePath, dirnameRemotePath, extnameOf, normalizeRemotePath } from './path'

export type FileEntryType = 'file' | 'directory'

export interface FileEntry {
  /** 名称，不含父路径 */
  name: string
  /** 统一 POSIX 路径，`/` 为连接根 */
  path: string
  /** 父目录路径，根为 `/` */
  parent: string
  type: FileEntryType
  /** 字节数；目录为 0 */
  size: number
  /** 毫秒时间戳；不可得为 0 */
  modifiedAt: number
  /** 小写扩展名，不含点；目录为 '' */
  extname: string
  /** WebDAV etag / SMB fileId；不可得为 '' */
  etag: string
  /** MIME 类型；不可得按扩展名推断，仍不可得为 '' */
  mime: string
}

/** 常见扩展名到 MIME 的兜底表（协议未提供 mime 时使用） */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  mov: 'video/quicktime',
  flv: 'video/x-flv',
  webm: 'video/webm',
  ts: 'video/mp2t',
  m2ts: 'video/mp2t',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  rmvb: 'application/vnd.rn-realmedia-vbr',
  iso: 'application/x-iso9660-image',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  srt: 'application/x-subrip',
  ass: 'text/x-ssa',
  ssa: 'text/x-ssa',
  sub: 'text/plain',
  vtt: 'text/vtt',
  nfo: 'text/xml',
  xml: 'text/xml',
  json: 'application/json',
  txt: 'text/plain',
  md: 'text/markdown',
  pdf: 'application/pdf',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed'
}

export function guessMimeType(name: string): string {
  return MIME_BY_EXTENSION[extnameOf(name)] ?? ''
}

export interface FileEntryInput {
  path: string
  type: FileEntryType
  name?: string
  size?: number
  modifiedAt?: number
  etag?: string
  mime?: string
}

/** 数值兜底：非有限值（含 NaN）一律回落 0，并向下取整 */
function toSafeInteger(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}

/** 统一构造 FileEntry：路径归一化、目录强制 size 0、mime 缺失时按扩展名推断 */
export function createFileEntry(input: FileEntryInput): FileEntry {
  const path = normalizeRemotePath(input.path)
  const name = input.name && input.name.length > 0 ? input.name : basenameRemotePath(path)
  const isDirectory = input.type === 'directory'
  return {
    name,
    path,
    parent: dirnameRemotePath(path),
    type: input.type,
    size: isDirectory ? 0 : toSafeInteger(input.size),
    modifiedAt: toSafeInteger(input.modifiedAt),
    extname: isDirectory ? '' : extnameOf(name),
    etag: input.etag ?? '',
    mime: isDirectory ? '' : (input.mime ?? guessMimeType(name))
  }
}

/** 目录在前、同类型按名称本地化排序 */
export function sortFileEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((left, right) => {
    if (left.type !== right.type) return left.type === 'directory' ? -1 : 1
    return left.name.localeCompare(right.name, 'zh-Hans-CN')
  })
}
