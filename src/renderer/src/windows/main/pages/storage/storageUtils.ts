/**
 * 存储管理页的纯展示工具：图标映射、尺寸/时间格式化、可预览判定。
 *
 * 只放无状态的常量与函数，页面状态在 ./composables 下。
 */
import dayjs from 'dayjs'
import type { Component } from 'vue'
import {
  CloudIcon,
  FileCodeIcon,
  FileIcon,
  FileImageIcon,
  FileMusicIcon,
  FilePdfIcon,
  FileTxtIcon,
  FileZipIcon,
  FolderIcon,
  HardDriveIcon,
  ServerIcon,
  VideoIcon
} from 'tdesign-icons-vue-next'
import { filePreviewKindOf, type FileEntry, type FileProtocol } from '@common/types/file'

/** 协议图标：数据源列表与浏览器标题共用 */
export const PROTOCOL_ICONS: Readonly<Record<FileProtocol, Component>> = {
  local: HardDriveIcon,
  webdav: CloudIcon,
  smb: ServerIcon
}

/** 协议的一句话说明，展示在新建 / 编辑连接的弹窗里 */
export const PROTOCOL_HINTS: Readonly<Record<FileProtocol, string>> = {
  local: '直接读写本机磁盘目录',
  webdav: '走 HTTP，支持服务端 MOVE / COPY 与流式读写',
  smb: '仅协商 SMB 2.0.2 / 2.1；无服务端复制，大目录复制较慢'
}

const CODE_EXTENSIONS = ['nfo', 'xml', 'json', 'yaml', 'yml', 'md', 'html', 'css', 'js', 'ts'] as const
const TEXT_EXTENSIONS = [
  'txt',
  'srt',
  'ass',
  'ssa',
  'vtt',
  'sub',
  'log',
  'ini',
  'conf',
  'csv',
  'm3u',
  'm3u8'
] as const

const ICON_GROUPS: readonly { icon: Component; extensions: readonly string[] }[] = [
  { icon: FileCodeIcon, extensions: CODE_EXTENSIONS },
  { icon: FileTxtIcon, extensions: TEXT_EXTENSIONS },
  { icon: FileImageIcon, extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'svg'] },
  {
    icon: VideoIcon,
    extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'ts', 'm2ts', 'mpg', 'mpeg', 'rmvb', 'iso']
  },
  { icon: FileMusicIcon, extensions: ['mp3', 'flac', 'wav', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'weba'] },
  { icon: FileZipIcon, extensions: ['zip', 'rar', '7z'] },
  { icon: FilePdfIcon, extensions: ['pdf'] }
]

/** 目录固定用文件夹图标，文件按扩展名分组，未命中回落通用文件图标 */
export function entryIcon(entry: FileEntry): Component {
  if (entry.type === 'directory') return FolderIcon
  const group = ICON_GROUPS.find((item) => item.extensions.includes(entry.extname))
  return group ? group.icon : FileIcon
}

/** 可预览：媒体（视频 / 图片 / 音频）与 nfo；目录与其它类型没有预览入口 */
export function isPreviewable(entry: FileEntry): boolean {
  if (entry.type !== 'file') return false
  return filePreviewKindOf(entry.mime, entry.extname) !== 'other'
}

/** 字节数按 1024 进制折算，目录与空文件显示为 “—” */
export function formatFileSize(size: number): string {
  if (size <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const digits = unitIndex === 0 || value >= 100 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unitIndex]}`
}

/** 修改时间统一展示到分钟 */
export function formatEntryTime(modifiedAt: number): string {
  if (modifiedAt <= 0) return '—'
  return dayjs(modifiedAt).format('YYYY-MM-DD HH:mm')
}
