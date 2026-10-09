/**
 * 文件连接配置的落盘存储。
 *
 * 契约：
 * 1. 落盘位置 `~/.vault-scrape/file/connections.json`，与设置文件相互独立；
 * 2. 密码不落明文：优先 `safeStorage`（系统钥匙串）加密，不可用时回落 base64 明文并在控制台告警；
 * 3. 对外只暴露 `hasPassword`，**密码永不跨 IPC**；
 * 4. 读取失败一律回落空列表，绝不因为配置损坏而阻塞启动。
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import {
  FILE_PROTOCOLS,
  SMB_DEFAULT_PORT,
  WEBDAV_AUTH_TYPES,
  FileError,
  type FileConnection,
  type FileConnectionDraft,
  type WebdavAuthType
} from '@common/types/file'
import { readBoolean, readEnum, readNumber, readString, readStringArray, toSource } from '@common/types/setting/shared'
import { PLUGIN_ID_PATTERN } from '@common/types/plugin'
import { decodeSecret, encodeSecret } from '$/utils/secretCodec'

/** 主进程私有的落盘形状：只比公开类型多一个 secret 字段 */
interface StoredLocalConnection {
  id: string
  name: string
  protocol: 'local'
  nsfw: boolean
  /** 该存储允许使用的刮削器（插件 ID）；空数组表示全部已启用插件 */
  scrapers: string[]
  rootPath: string
}

interface StoredWebdavConnection {
  id: string
  name: string
  protocol: 'webdav'
  nsfw: boolean
  /** 该存储允许使用的刮削器（插件 ID）；空数组表示全部已启用插件 */
  scrapers: string[]
  url: string
  username: string
  authType: WebdavAuthType
  secret: string
}

interface StoredSmbConnection {
  id: string
  name: string
  protocol: 'smb'
  nsfw: boolean
  /** 该存储允许使用的刮削器（插件 ID）；空数组表示全部已启用插件 */
  scrapers: string[]
  host: string
  port: number
  share: string
  domain: string
  username: string
  secret: string
}

type StoredConnection = StoredLocalConnection | StoredWebdavConnection | StoredSmbConnection

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

/** 单个存储可配置的刮削器数量上限（防止脏数据撑爆配置） */
const SCRAPER_LIMIT = 200

/** 刮削器 ID 归一化：去空白、只留合法插件 ID、去重、限量 */
function normalizeScrapers(input: readonly string[]): string[] {
  const result: string[] = []
  for (const item of input) {
    const id = item.trim()
    if (id.length === 0 || !PLUGIN_ID_PATTERN.test(id) || result.includes(id)) continue
    result.push(id)
    if (result.length >= SCRAPER_LIMIT) break
  }
  return result
}

function readScrapers(source: Record<string, unknown>): string[] {
  return normalizeScrapers(readStringArray(source, 'scrapers', []))
}

function normalizeStored(raw: unknown): StoredConnection | null {
  const source = toSource(raw)
  if (!source) return null
  const id = readString(source, 'id', '')
  const name = readString(source, 'name', '')
  if (id.length === 0 || name.length === 0) return null
  const protocol = readEnum(source, 'protocol', FILE_PROTOCOLS, 'local')
  const secret = readString(source, 'secret', '')
  const nsfw = readBoolean(source, 'nsfw', false)
  const scrapers = readScrapers(source)
  if (protocol === 'local') {
    const rootPath = readString(source, 'rootPath', '')
    return rootPath.length === 0 ? null : { id, name, protocol, nsfw, scrapers, rootPath }
  }
  if (protocol === 'webdav') {
    const url = readString(source, 'url', '')
    if (url.length === 0) return null
    return {
      id,
      name,
      protocol,
      nsfw,
      scrapers,
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
    nsfw,
    scrapers,
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
  return previous !== null && previous.protocol !== 'local' ? previous.secret : ''
}

function previousSmbPort(previous: StoredConnection | null): number {
  return previous !== null && previous.protocol === 'smb' ? previous.port : SMB_DEFAULT_PORT
}

function toPublicConnection(stored: StoredConnection): FileConnection {
  if (stored.protocol === 'local') {
    return {
      id: stored.id,
      name: stored.name,
      protocol: 'local',
      hasPassword: false,
      nsfw: stored.nsfw,
      scrapers: stored.scrapers,
      rootPath: stored.rootPath
    }
  }
  if (stored.protocol === 'webdav') {
    return {
      id: stored.id,
      name: stored.name,
      protocol: 'webdav',
      hasPassword: stored.secret.length > 0,
      nsfw: stored.nsfw,
      scrapers: stored.scrapers,
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
    nsfw: stored.nsfw,
    scrapers: stored.scrapers,
    host: stored.host,
    port: stored.port,
    share: stored.share,
    domain: stored.domain,
    username: stored.username
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

/** password 为 undefined 表示「保持已保存的密码」，空串表示清空 */
function buildStored(
  draft: FileConnectionDraft,
  id: string,
  previous: StoredConnection | null
): StoredConnection {
  const name = draft.name.trim()
  if (name.length === 0) throw new FileError('invalidArgument', '连接名称不能为空')
  const nsfw = draft.nsfw === true
  const scrapers = normalizeScrapers(draft.scrapers)
  if (draft.protocol === 'local') {
    const rootPath = draft.rootPath.trim()
    if (rootPath.length === 0) throw new FileError('invalidArgument', '本机根目录不能为空')
    return { id, name, protocol: 'local', nsfw, scrapers, rootPath }
  }
  const username = draft.username.trim()
  const secret = draft.password === undefined ? previousSecret(previous) : encodeSecret(draft.password, 'file')
  if (draft.protocol === 'webdav') {
    const url = draft.url.trim()
    if (!isValidUrl(url)) throw new FileError('invalidArgument', '服务地址不是合法的 URL')
    const authType = WEBDAV_AUTH_TYPES.includes(draft.authType) ? draft.authType : 'auto'
    return { id, name, protocol: 'webdav', nsfw, scrapers, url, username, authType, secret }
  }
  const host = draft.host.trim()
  const share = draft.share.trim()
  if (host.length === 0) throw new FileError('invalidArgument', '主机地址不能为空')
  if (share.length === 0) throw new FileError('invalidArgument', '共享名不能为空')
  const port = draft.port ?? previousSmbPort(previous)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new FileError('invalidArgument', '端口必须是 1 到 65535 之间的整数')
  }
  return {
    id,
    name,
    protocol: 'smb',
    nsfw,
    scrapers,
    host,
    port,
    share,
    domain: draft.domain?.trim() ?? '',
    username,
    secret
  }
}

/** 全部连接（已脱敏，不含密码） */
export function listConnections(): FileConnection[] {
  return readStore().connections.map(toPublicConnection)
}

export function getConnection(id: string): FileConnection | null {
  const stored = readStore().connections.find((item) => item.id === id)
  return stored ? toPublicConnection(stored) : null
}

/** 仅供主进程内部构造客户端使用，绝不跨 IPC 返回 */
export function loadConnectionPassword(id: string): string {
  const stored = readStore().connections.find((item) => item.id === id)
  if (!stored) return ''
  return decodeConnectionSecret(previousSecret(stored), stored.name)
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
 * id 存在且未传 password 时，沿用已保存的密码。
 */
export function buildConnectionFromDraft(draft: FileConnectionDraft): {
  connection: FileConnection
  password: string
} {
  const store = readStore()
  const previous = draft.id
    ? (store.connections.find((item) => item.id === draft.id) ?? null)
    : null
  const id = draft.id && draft.id.length > 0 ? draft.id : DRAFT_CONNECTION_ID
  const connection = toPublicConnection(buildStored(draft, id, previous))
  const password =
    draft.protocol === 'local'
      ? ''
      : draft.password === undefined
        ? decodeConnectionSecret(previousSecret(previous), connection.name)
        : draft.password
  return { connection, password }
}
