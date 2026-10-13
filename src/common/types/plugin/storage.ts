/**
 * 存储插件（kind: 'storage'）的契约。
 *
 * 契约：
 * - 存储插件把「网盘等云端存储」接入文件模块：插件只负责元数据（列目录 / 查条目）
 *   与解析下载直链，字节流（Range 播放、读文本、下载落盘）一律由宿主拿直链自行完成；
 * - 第一版只读：方法表只有 list / stat / resolve 三个必需方法，写类方法后续按需扩展
 *   （签名统一 `(input, env, ctx)`，扩展不影响既有插件）；
 * - `path` 是连接内 POSIX 路径（`/` 为连接根，与 FileEntry.path 同一口径），
 *   网盘内部的文件 ID、路径缓存都由插件自己维护；
 * - 配置取值挂在连接上而非插件上：同一个插件可以建多个连接（不同账号 / 不同根目录），
 *   插件用 `env` 声明连接配置字段模板（`secret: true` 的字段加密落盘、界面不回显），
 *   取值由宿主在调用时作为 `env` 参数传入。
 */
import type { PluginContext } from './define'
import type { PluginEnvValue } from './manifest'

/** 插件返回的条目：字段口径与 FileEntry 对齐，宿主负责补全 parent / extname / mime */
export interface PluginStorageEntry {
  /** 连接内 POSIX 路径，`/` 为连接根 */
  path: string
  /** 名称，不含父路径 */
  name: string
  type: 'file' | 'directory'
  /** 字节数；目录缺省或 0 */
  size?: number
  /** 毫秒时间戳；不可得缺省 */
  modifiedAt?: number
}

/** list 的入参：`cursor` 为上一次返回的 `nextCursor`，首页不传 */
export interface PluginStorageListInput {
  path: string
  cursor?: string
}

export interface PluginStorageListResult {
  entries: PluginStorageEntry[]
  /** 非空表示还有下一页，宿主会带着它继续调用直到为空 */
  nextCursor?: string
}

/** resolve 的返回：直链 + 取字节时需要的请求头 + 有效期（秒，缺省按 300 处理） */
export interface PluginStorageResolveResult {
  url: string
  headers?: Record<string, string>
  ttlSeconds?: number
}

/** 存储插件：三个方法全部必填 */
export interface StoragePlugin {
  /** 列目录（游标分页，单页即可，宿主负责翻完） */
  list(
    input: PluginStorageListInput,
    env: PluginEnvValue,
    ctx: PluginContext
  ): Promise<PluginStorageListResult>
  /** 查询单个条目；不存在时抛错即可，宿主按 notFound 收敛 */
  stat(input: { path: string }, env: PluginEnvValue, ctx: PluginContext): Promise<PluginStorageEntry>
  /** 解析下载直链：readRange / readText / download 的唯一字节来源 */
  resolve(
    input: { path: string },
    env: PluginEnvValue,
    ctx: PluginContext
  ): Promise<PluginStorageResolveResult>
}

export function isPluginStorageEntryType(value: unknown): value is PluginStorageEntry['type'] {
  return value === 'file' || value === 'directory'
}
