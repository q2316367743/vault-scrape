/**
 * 文件模块的连接（数据源）定义。
 *
 * 契约：
 * - 密码（及敏感配置）永不跨 IPC：对外形状只有 `hasPassword` 布尔值，密文只存在主进程的存储文件里；
 * - 一个 SMB 连接对应一个共享（share），连接根即该共享根；
 * - 草稿（Draft）的 `id` 缺省表示新建；密码 / 敏感配置字段缺省表示保持已存值、空串表示清空；
 * - 刮削器不再挂在存储上，改由资料库（library）配置；
 * - **连接上没有任何策略字段**：NSFW 只由资料库的 `nsfwProtection` 与应用设置的
 *   `nsfwProtection` 总开关决定（见 `@/hooks/UseNsfwProtection`）；
 * - 协议分内置（local / webdav / smb）与插件（存储插件的 meta.id）两类：
 *   插件连接的配置字段由插件声明（见 `@common/types/plugin` 的 storage 类别），
 *   非敏感字段明文存 `config`，敏感字段只在主进程落盘密文。
 */
export type BuiltinFileProtocol = 'local' | 'webdav' | 'smb'

/**
 * 连接协议：内置协议之外，其余取值都是存储插件的 meta.id。
 * `(string & {})` 保留字面量的自动补全，同时放行任意插件 id。
 */
export type FileProtocol = BuiltinFileProtocol | (string & {})

export const FILE_PROTOCOLS: readonly BuiltinFileProtocol[] = ['local', 'webdav', 'smb']

export const FILE_PROTOCOL_LABELS: Readonly<Record<BuiltinFileProtocol, string>> = {
  local: '本地磁盘',
  webdav: 'WebDAV',
  smb: 'SMB'
}

export function isBuiltinFileProtocol(value: string): value is BuiltinFileProtocol {
  return FILE_PROTOCOLS.some((item) => item === value)
}

/**
 * 协议展示名：内置协议用固定文案，插件协议优先用插件名（调用方查不到时回落插件 id）。
 * 渲染层与主进程共用，禁止各自再写一份映射。
 */
export function protocolLabel(protocol: FileProtocol, pluginName?: string): string {
  if (isBuiltinFileProtocol(protocol)) return FILE_PROTOCOL_LABELS[protocol]
  return pluginName ?? protocol
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

/**
 * 插件连接：protocol 是存储插件的 meta.id。
 * `config` 只含非敏感字段（明文、可跨 IPC 回显）；敏感字段的密文只存在主进程落盘文件里，
 * 对外只暴露 `hasPassword` 掩码。
 */
export interface PluginConnection {
  id: string
  name: string
  protocol: string
  hasPassword: boolean
  config: Record<string, string>
}

export type FileConnection = LocalConnection | WebdavConnection | SmbConnection | PluginConnection

/** 结构判别：插件连接一定带 `config`，内置连接没有（protocol 是 string，字面量比较无法收窄） */
export function isPluginConnection(connection: FileConnection): connection is PluginConnection {
  return 'config' in connection
}

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

export interface PluginConnectionDraft {
  id?: string
  /** 存储插件的 meta.id */
  protocol: string
  name: string
  /**
   * 完整配置（含敏感字段明文）：非 secret 字段每次全量提交；
   * secret 字段缺省表示保持已存值、空串表示清空，与密码约定一致。
   */
  config: Record<string, string>
}

export type FileConnectionDraft =
  | LocalConnectionDraft
  | WebdavConnectionDraft
  | SmbConnectionDraft
  | PluginConnectionDraft

/** 连接的一句话描述，用于日志与错误文案；插件协议优先显示插件名 */
export function describeConnection(connection: FileConnection, pluginName?: string): string {
  if (isPluginConnection(connection)) {
    return `${pluginName ?? connection.protocol} ${connection.name}`
  }
  if (connection.protocol === 'local') return `本地磁盘 ${connection.rootPath}`
  if (connection.protocol === 'webdav') return `WebDAV ${connection.url}`
  return `SMB ${connection.host}:${connection.port}/${connection.share}`
}
