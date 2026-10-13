/**
 * 文件连接配置的落盘存储。
 *
 * 契约：
 * 1. 落盘位置 `~/.vault-scrape/file/connections.json`，与设置文件相互独立；
 * 2. 密码与敏感配置不落明文：优先 `safeStorage`（系统钥匙串）加密，不可用时回落 base64 明文并在控制台告警；
 * 3. 对外只暴露 `hasPassword`，**密码与敏感配置永不跨 IPC**；
 * 4. 读取失败一律回落空列表，绝不因为配置损坏而阻塞启动；
 * 5. 连接上没有策略字段：旧版本写下的 `nsfw` 键在归一化时被直接忽略，不再回写；
 * 6. 插件连接（protocol = 存储插件 id）的配置字段由插件声明：非 secret 字段明文存
 *    `config`，secret 字段加密存 `secrets`；落盘时**不校验插件是否存在**（运行时才报错）。
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import {
  SMB_DEFAULT_PORT,
  WEBDAV_AUTH_TYPES,
  FileError,
  isBuiltinFileProtocol,
  type FileConnection,
  type FileConnectionDraft,
  type PluginConnectionDraft,
  type WebdavAuthType
} from '@common/types/file'
import type { PluginEnvField } from '@common/types/plugin'
import { PluginError } from '@common/types/plugin'
import { readEnum, readNumber, readString, toSource } from '@common/types/setting/shared'
import { decodeSecret, encodeSecret } from '$/utils/secretCodec'
import { storagePlugins } from '../plugin/pluginRegistries'

/** 主进程私有的落盘形状：只比公开类型多一个 secret（密文）字段 */
interface StoredLocalConnection {
  id: string
  name: string
  protocol: 'local'
  rootPath: string
}

interface StoredWebdavConnection {
  id: string
  name: string
  protocol: 'webdav'
  url: string
  username: string
  authType: WebdavAuthType
  secret: string
}

interface StoredSmbConnection {
  id: string
  name: string
  protocol: 'smb'
  host: string
  port: number
  share: string
  domain: string
  username: string
  secret: string
}

interface StoredPluginConnection {
  id: string
  name: string
  /** 存储插件的 meta.id */
  protocol: string
  /** 非敏感配置（明文） */
  config: Record<string, string>
  /** secret 字段密文（`safe:` / `plain:` 前缀，由 secretCodec 约定） */
  secrets: Record<string, string>
}

type StoredConnection =
  | StoredLocalConnection
  | StoredWebdavConnection
  | StoredSmbConnection
  | StoredPluginConnection

/** 连接凭据：构造文件客户端所需的机密材料，只在主进程内部流转 */
export interface ConnectionCredential {
  /** 内置协议的连接密码；插件连接为空串 */
  password: string
  /** 插件连接的完整配置（敏感字段已解密）；内置连接为空对象 */
  config: Record<string, string>
}

interface StoredFile {
  version: number
  connections: StoredConnection[]
}

const STORE_VERSION = 1
/** 测试连接时构造的临时连接 id，不会落盘 */
export const DRAFT_CONNECTION_ID = 'draft'

let cache: StoredFile | null = null

function connectionFilePath(): string {
  return join(app.getPath('home'), '.vault-scrape', 'file', 'connections.json')
}

function emptyStore(): StoredFile {
  return { version: STORE_VERSION, connections: [] }
}

function readPort(source: Record<string, unknown>): number {
  const port = readNumber(source, 'port', SMB_DEFAULT_PORT, 1)
  return port <= 65535 ? port : SMB_DEFAULT_PORT
}

/** 读取对象里的一层字符串键值（插件连接的 config / secrets） */
function readStringMap(source: Record<string, unknown>, key: string): Record<string, string> {
  const raw = toSource(source[key])
  const result: Record<string, string> = {}
  if (!raw) return result
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === 'string' && value.length > 0) result[name] = value
  }
  return result
}

function isPluginStored(source: StoredConnection): source is StoredPluginConnection {
  return 'secrets' in source && 'config' in source
}

function normalizeStored(raw: unknown): StoredConnection | null {
  const source = toSource(raw)
  if (!source) return null
  const id = readString(source, 'id', '')
  const name = readString(source, 'name', '')
  if (id.length === 0 || name.length === 0) return null
  const protocol = readString(source, 'protocol', '')
  if (!isBuiltinFileProtocol(protocol)) {
    // 插件连接：配置字段是动态的，这里只做形状清洗，不校验插件存在性
    return {
      id,
      name,
      protocol,
      config: readStringMap(source, 'config'),
      secrets: readStringMap(source, 'secrets')
    }
  }
  const secret = readString(source, 'secret', '')
  if (protocol === 'local') {
    const rootPath = readString(source, 'rootPath', '')
    return rootPath.length === 0 ? null : { id, name, protocol, rootPath }
  }
  if (protocol === 'webdav') {
    const url = readString(source, 'url', '')
    if (url.length === 0) return null
    return {
      id,
      name,
      protocol,
      url,
      username: readString(source, 'username', ''),
      authType: readEnum(source, 'authType', WEBDAV_AUTH_TYPES, 'auto'),
      secret
    }
  }
  const host = readString(source, 'host', '')
  const share = readString(source, 'share', '')
  if (host.length === 0 || share.length === 0) return null
  return {
    id,
    name,
    protocol,
    host,
    port: readPort(source),
    share,
    domain: readString(source, 'domain', ''),
    username: readString(source, 'username', ''),
    secret
  }
}

function readFromDisk(): StoredFile {
  const filePath = connectionFilePath()
  if (!existsSync(filePath)) return emptyStore()
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf-8'))
    const source = toSource(parsed)
    if (!source) return emptyStore()
    const list = Array.isArray(source.connections) ? source.connections : []
    return {
      version: STORE_VERSION,
      connections: list
        .map(normalizeStored)
        .filter((item): item is StoredConnection => item !== null)
    }
  } catch (error) {
    console.error('[file] 连接配置读取失败，已回落为空列表', error)
    return emptyStore()
  }
}

function readStore(): StoredFile {
  if (cache === null) cache = readFromDisk()
  return cache
}

function writeStore(store: StoredFile): void {
  const filePath = connectionFilePath()
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, 'utf-8')
  cache = store
}

/** 解密连接密码；失败时抛 `authFailed`，提示用户重新填写 */
function decodeConnectionSecret(secret: string, label: string): string {
  return decodeSecret(secret, () => new FileError('authFailed', `已保存的密码无法解密，请重新填写密码（${label}）`))
}

function previousSecret(previous: StoredConnection | null): string {
  return previous !== null && !isPluginStored(previous) && previous.protocol !== 'local'
    ? previous.secret
    : ''
}

function previousPlugin(previous: StoredConnection | null): StoredPluginConnection | null {
  return previous !== null && isPluginStored(previous) ? previous : null
}

function previousSmb(previous: StoredConnection | null): StoredSmbConnection | null {
  return previous !== null && !isPluginStored(previous) && previous.protocol === 'smb'
    ? previous
    : null
}

function toPublicConnection(stored: StoredConnection): FileConnection {
  if (isPluginStored(stored)) {
    return {
      id: stored.id,
      name: stored.name,
      protocol: stored.protocol,
      hasPassword: Object.keys(stored.secrets).length > 0,
      config: { ...stored.config }
    }
  }
  if (stored.protocol === 'local') {
    return {
      id: stored.id,
      name: stored.name,
      protocol: 'local',
      hasPassword: false,
      rootPath: stored.rootPath
    }
  }
  if (stored.protocol === 'webdav') {
    return {
      id: stored.id,
      name: stored.name,
      protocol: 'webdav',
      hasPassword: stored.secret.length > 0,
      url: stored.url,
      username: stored.username,
      authType: stored.authType
    }
  }
  return {
    id: stored.id,
    name: stored.name,
    protocol: 'smb',
    hasPassword: stored.secret.length > 0,
    host: stored.host,
    port: stored.port,
    share: stored.share,
    domain: stored.domain,
    username: stored.username
  }
}

/** 从落盘形状解出构造客户端所需的凭据（敏感字段解密） */
function credentialOfStored(stored: StoredConnection): ConnectionCredential {
  if (isPluginStored(stored)) {
    const config: Record<string, string> = { ...stored.config }
    for (const [key, secret] of Object.entries(stored.secrets)) {
      config[key] = decodeConnectionSecret(secret, stored.name)
    }
    return { password: '', config }
  }
  return {
    password: stored.protocol === 'local' ? '' : decodeConnectionSecret(stored.secret, stored.name),
    config: {}
  }
}

function isValidUrl(value: string): boolean {
  try {
    // eslint-disable-next-line no-new -- 只为校验合法性，不保留实例
    new URL(value)
    return true
  } catch {
    return false
  }
}

/** 查存储插件的连接配置字段声明；插件不存在 / 加载失败收敛成 FileError */
function pluginConfigFields(pluginId: string): PluginEnvField[] {
  try {
    return storagePlugins.readPluginEnv(pluginId).fields
  } catch (error) {
    const message = error instanceof PluginError ? error.message : '插件不可用'
    throw new FileError('invalidArgument', `存储插件不可用：${message}`)
  }
}

/** 插件连接草稿 → 落盘形状：按声明表分拣 config / secrets 并校验必填 */
function buildStoredPlugin(
  draft: PluginConnectionDraft,
  id: string,
  previous: StoredPluginConnection | null
): StoredPluginConnection {
  const fields = pluginConfigFields(draft.protocol)
  const config: Record<string, string> = {}
  const secrets: Record<string, string> = {}
  for (const field of fields) {
    const value = draft.config[field.key]
    if (field.secret === true) {
      // 与密码同约定：缺省 = 保持已存，空串 = 清空
      if (value === undefined) {
        const kept = previous?.secrets[field.key]
        if (kept !== undefined && kept.length > 0) secrets[field.key] = kept
      } else if (value.length > 0) {
        secrets[field.key] = encodeSecret(value, 'file')
      }
      continue
    }
    if (value !== undefined && value.length > 0) config[field.key] = value
  }
  for (const field of fields) {
    if (field.required !== true) continue
    const filled =
      field.secret === true
        ? (secrets[field.key]?.length ?? 0) > 0
        : (config[field.key]?.length ?? 0) > 0
    if (!filled) throw new FileError('invalidArgument', `请先填写「${field.label}」`)
  }
  return { id, name: draft.name.trim(), protocol: draft.protocol, config, secrets }
}

function buildStored(
  draft: FileConnectionDraft,
  id: string,
  previous: StoredConnection | null
): StoredConnection {
  const name = draft.name.trim()
  if (name.length === 0) throw new FileError('invalidArgument', '连接名称不能为空')
  if ('config' in draft) {
    return buildStoredPlugin(draft, id, previousPlugin(previous))
  }
  if (draft.protocol === 'local') {
    const rootPath = draft.rootPath.trim()
    if (rootPath.length === 0) throw new FileError('invalidArgument', '本机根目录不能为空')
    return { id, name, protocol: 'local', rootPath }
  }
  const username = draft.username.trim()
  const secret = draft.password === undefined ? previousSecret(previous) : encodeSecret(draft.password, 'file')
  if (draft.protocol === 'webdav') {
    const url = draft.url.trim()
    if (!isValidUrl(url)) throw new FileError('invalidArgument', '服务地址不是合法的 URL')
    const authType = WEBDAV_AUTH_TYPES.includes(draft.authType) ? draft.authType : 'auto'
    return { id, name, protocol: 'webdav', url, username, authType, secret }
  }
  const host = draft.host.trim()
  const share = draft.share.trim()
  if (host.length === 0) throw new FileError('invalidArgument', '主机地址不能为空')
  if (share.length === 0) throw new FileError('invalidArgument', '共享名不能为空')
  const previousPort = previousSmb(previous)?.port ?? SMB_DEFAULT_PORT
  const port = draft.port ?? previousPort
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new FileError('invalidArgument', '端口必须是 1 到 65535 之间的整数')
  }
  return {
    id,
    name,
    protocol: 'smb',
    host,
    port,
    share,
    domain: draft.domain?.trim() ?? '',
    username,
    secret
  }
}

/** 全部连接（已脱敏，不含密码与敏感配置） */
export function listConnections(): FileConnection[] {
  return readStore().connections.map(toPublicConnection)
}

export function getConnection(id: string): FileConnection | null {
  const stored = readStore().connections.find((item) => item.id === id)
  return stored ? toPublicConnection(stored) : null
}

/** 仅供主进程内部构造客户端使用，绝不跨 IPC 返回 */
export function loadConnectionCredential(id: string): ConnectionCredential {
  const stored = readStore().connections.find((item) => item.id === id)
  if (!stored) return { password: '', config: {} }
  return credentialOfStored(stored)
}

export function saveConnection(draft: FileConnectionDraft): FileConnection {
  const store = readStore()
  const id = draft.id && draft.id.length > 0 ? draft.id : randomUUID()
  const index = store.connections.findIndex((item) => item.id === id)
  const previous = index >= 0 ? store.connections[index] : null
  const next = buildStored(draft, id, previous)
  if (index >= 0) store.connections[index] = next
  else store.connections.push(next)
  writeStore(store)
  return toPublicConnection(next)
}

export function deleteConnection(id: string): boolean {
  const store = readStore()
  const next = store.connections.filter((item) => item.id !== id)
  if (next.length === store.connections.length) return false
  writeStore({ version: STORE_VERSION, connections: next })
  return true
}

/**
 * 用草稿构造「不落盘」的临时连接：测试连接用。
 * id 存在且 secret 字段未提交时，沿用已保存的敏感配置。
 */
export function buildConnectionFromDraft(draft: FileConnectionDraft): {
  connection: FileConnection
  credential: ConnectionCredential
} {
  const store = readStore()
  const previous = draft.id
    ? (store.connections.find((item) => item.id === draft.id) ?? null)
    : null
  const id = draft.id && draft.id.length > 0 ? draft.id : DRAFT_CONNECTION_ID
  const stored = buildStored(draft, id, previous)
  return { connection: toPublicConnection(stored), credential: credentialOfStored(stored) }
}
