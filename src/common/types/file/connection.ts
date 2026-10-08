/**
 * 文件模块的连接（数据源）定义。
 *
 * 契约：
 * - 密码永不跨 IPC：对外形状只有 `hasPassword` 布尔值，密文只存在主进程的存储文件里；
 * - 一个 SMB 连接对应一个共享（share），连接根即该共享根；
 * - 草稿（Draft）的 `id` 缺省表示新建，`password` 缺省表示保持已存密码、空串表示清空。
 */
export type FileProtocol = 'local' | 'webdav' | 'smb'

export const FILE_PROTOCOLS: readonly FileProtocol[] = ['local', 'webdav', 'smb']

export const FILE_PROTOCOL_LABELS: Readonly<Record<FileProtocol, string>> = {
  local: '本地磁盘',
  webdav: 'WebDAV',
  smb: 'SMB'
}

export type WebdavAuthType = 'auto' | 'basic' | 'digest' | 'none'

export const WEBDAV_AUTH_TYPES: readonly WebdavAuthType[] = ['auto', 'basic', 'digest', 'none']

export const SMB_DEFAULT_PORT = 445

export interface LocalConnection {
  id: string
  name: string
  protocol: 'local'
  hasPassword: false
  /** 本机绝对路径 */
  rootPath: string
}

export interface WebdavConnection {
  id: string
  name: string
  protocol: 'webdav'
  hasPassword: boolean
  url: string
  username: string
  authType: WebdavAuthType
}

export interface SmbConnection {
  id: string
  name: string
  protocol: 'smb'
  hasPassword: boolean
  host: string
  port: number
  /** 共享名，即连接根 */
  share: string
  /** AD 域，可空串 */
  domain: string
  username: string
}

export type FileConnection = LocalConnection | WebdavConnection | SmbConnection

export interface LocalConnectionDraft {
  id?: string
  protocol: 'local'
  name: string
  rootPath: string
}

export interface WebdavConnectionDraft {
  id?: string
  protocol: 'webdav'
  name: string
  url: string
  username: string
  authType: WebdavAuthType
  password?: string
}

export interface SmbConnectionDraft {
  id?: string
  protocol: 'smb'
  name: string
  host: string
  port?: number
  share: string
  domain?: string
  username: string
  password?: string
}

export type FileConnectionDraft =
  | LocalConnectionDraft
  | WebdavConnectionDraft
  | SmbConnectionDraft

/** 连接的一句话描述，用于日志与错误文案 */
export function describeConnection(connection: FileConnection): string {
  if (connection.protocol === 'local') return `本地磁盘 ${connection.rootPath}`
  if (connection.protocol === 'webdav') return `WebDAV ${connection.url}`
  return `SMB ${connection.host}:${connection.port}/${connection.share}`
}
