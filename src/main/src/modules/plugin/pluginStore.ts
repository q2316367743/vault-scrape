/**
 * 插件索引、源码与环境变量的落盘存储。
 *
 * 契约：
 * 1. 落盘位置 `~/.vault-scrape/plugin/`：`plugins.json` 存索引与环境变量，`<id>.js` 存源码；
 * 2. 环境变量一律按敏感值处理、不落明文：复用 `$/utils/secretCodec`（safeStorage 优先，不可用时回落 base64 并告警）；
 * 3. 对外只暴露 `PluginSummary` 与「是否已填写」掩码，明文永不跨 IPC；
 * 4. 读取失败一律回落空索引，绝不因为索引损坏而阻塞启动。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { app } from 'electron'
import {
  PLUGIN_ID_PATTERN,
  PluginError,
  isEnvReady,
  normalizeEnvFields,
  normalizeEnvValues,
  readEnvFilledMask,
  type PluginEnvDraft,
  type PluginEnvField,
  type PluginEnvValue,
  type PluginMeta,
  type PluginSummary
} from '@common/types/plugin'
import { readBoolean, readNumber, readString, toSource } from '@common/types/setting/shared'
import { decodeSecret, encodeSecret } from '$/utils/secretCodec'

/** 单个插件源码大小上限 */
export const PLUGIN_SOURCE_LIMIT_BYTES = 1024 * 1024

const STORE_VERSION = 1

/** 索引里的插件记录：元信息 + 环境变量；敏感值只存密文 */
export interface StoredPlugin {
  id: string
  name: string
  version: string
  author: string
  description: string
  enabled: boolean
  /** 上次校验通过时的环境变量声明表，避免渲染列表时重新编译源码 */
  envFields: PluginEnvField[]
  /** 环境变量密文：key -> `safe:` / `plain:` 开头的编码串，未填写的项不存在 */
  envValues: PluginEnvValue
  updatedAt: number
}

interface StoredFile {
  version: number
  plugins: StoredPlugin[]
}

let cache: StoredFile | null = null

function pluginDir(): string {
  return join(app.getPath('home'), '.vault-scrape', 'plugin')
}

function indexPath(): string {
  return join(pluginDir(), 'plugins.json')
}

/** 插件源码路径；ID 必须合法，否则可能造成路径逃逸 */
export function pluginSourcePath(id: string): string {
  if (!PLUGIN_ID_PATTERN.test(id)) throw new PluginError('invalidArgument', `插件 ID 不合法：${id}`)
  return join(pluginDir(), `${id}.js`)
}

function emptyStore(): StoredFile {
  return { version: STORE_VERSION, plugins: [] }
}

function normalizeStored(raw: unknown): StoredPlugin | null {
  const source = toSource(raw)
  if (!source) return null
  const id = readString(source, 'id', '')
  if (!PLUGIN_ID_PATTERN.test(id)) return null
  const envFields = normalizeEnvFields(source.envFields)
  return {
    id,
    name: readString(source, 'name', id),
    version: readString(source, 'version', ''),
    author: readString(source, 'author', ''),
    description: readString(source, 'description', ''),
    enabled: readBoolean(source, 'enabled', true),
    envFields,
    envValues: normalizeEnvValues(envFields, source.envValues),
    updatedAt: readNumber(source, 'updatedAt', 0)
  }
}

function readFromDisk(): StoredFile {
  const filePath = indexPath()
  if (!existsSync(filePath)) return emptyStore()
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf-8'))
    const source = toSource(parsed)
    if (!source) return emptyStore()
    const list = Array.isArray(source.plugins) ? source.plugins : []
    return {
      version: STORE_VERSION,
      plugins: list.map(normalizeStored).filter((item): item is StoredPlugin => item !== null)
    }
  } catch (error) {
    console.error('[plugin] 插件索引读取失败，已回落为空列表', error)
    return emptyStore()
  }
}

function readStore(): StoredFile {
  if (cache === null) cache = readFromDisk()
  return cache
}

function writeStore(store: StoredFile): void {
  const filePath = indexPath()
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, 'utf-8')
  cache = store
}

/** 索引里的全部插件记录（含敏感值密文，仅主进程内部使用） */
export function listStoredPlugins(): StoredPlugin[] {
  return readStore().plugins.map((item) => ({ ...item }))
}

export function getStoredPlugin(id: string): StoredPlugin | null {
  const stored = readStore().plugins.find((item) => item.id === id)
  return stored ? { ...stored } : null
}

/** 读取插件源码；文件缺失按 notFound 处理 */
export function readPluginSource(id: string): string {
  const filePath = pluginSourcePath(id)
  if (!existsSync(filePath)) {
    throw new PluginError('notFound', `插件源码不存在：${basename(filePath)}`)
  }
  try {
    return readFileSync(filePath, 'utf-8')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new PluginError('io', `插件源码读取失败：${detail}`)
  }
}

/** 读取外部插件文件（导入用）：只接受 .js，且不得超过大小上限 */
export function readPluginFile(sourcePath: string): string {
  if (extname(sourcePath).toLowerCase() !== '.js') {
    throw new PluginError('unsupported', '只支持导入 .js 插件脚本')
  }
  let text: string
  try {
    text = readFileSync(sourcePath, 'utf-8')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new PluginError('io', `插件文件读取失败：${detail}`)
  }
  if (text.trim().length === 0) throw new PluginError('invalidPlugin', '插件源码为空')
  if (Buffer.byteLength(text, 'utf-8') > PLUGIN_SOURCE_LIMIT_BYTES) {
    throw new PluginError(
      'invalidPlugin',
      `插件源码超过 ${Math.floor(PLUGIN_SOURCE_LIMIT_BYTES / 1024)} KB 上限`
    )
  }
  return text
}

export interface PluginSourceRecord {
  meta: PluginMeta
  envFields: PluginEnvField[]
}

/**
 * 落盘插件源码与索引。
 *
 * 已存在同 ID 插件时：未开启覆盖则抛 `duplicate`；覆盖时保留原有启停状态与环境变量，
 * 并按新的声明表重新归一化。
 */
export function writePluginSource(
  source: string,
  record: PluginSourceRecord,
  options: { overwrite: boolean }
): StoredPlugin {
  const store = readStore()
  const previous = store.plugins.find((item) => item.id === record.meta.id) ?? null
  if (previous && !options.overwrite) {
    throw new PluginError('duplicate', `插件 ${record.meta.id} 已存在，请确认是否覆盖`)
  }
  const envFields = record.envFields
  const next: StoredPlugin = {
    id: record.meta.id,
    name: record.meta.name,
    version: record.meta.version,
    author: record.meta.author ?? '',
    description: record.meta.description ?? '',
    enabled: previous ? previous.enabled : true,
    envFields,
    envValues: normalizeEnvValues(envFields, previous?.envValues),
    updatedAt: Date.now()
  }
  mkdirSync(pluginDir(), { recursive: true })
  writeFileSync(pluginSourcePath(next.id), source, 'utf-8')
  const plugins = previous
    ? store.plugins.map((item) => (item.id === next.id ? next : item))
    : [...store.plugins, next]
  writeStore({ version: STORE_VERSION, plugins })
  return next
}

/** 缓存编译产出的环境变量声明表（源码未变但声明变化时使用） */
export function cachePluginEnvFields(id: string, envFields: PluginEnvField[]): StoredPlugin | null {
  const store = readStore()
  const stored = store.plugins.find((item) => item.id === id)
  if (!stored) return null
  const next: StoredPlugin = {
    ...stored,
    envFields,
    envValues: normalizeEnvValues(envFields, stored.envValues)
  }
  writeStore({
    version: STORE_VERSION,
    plugins: store.plugins.map((item) => (item.id === id ? next : item))
  })
  return next
}

export function setPluginEnabled(id: string, enabled: boolean): StoredPlugin {
  const store = readStore()
  const stored = store.plugins.find((item) => item.id === id)
  if (!stored) throw new PluginError('notFound')
  const next: StoredPlugin = { ...stored, enabled }
  writeStore({
    version: STORE_VERSION,
    plugins: store.plugins.map((item) => (item.id === id ? next : item))
  })
  return next
}

/** 删除插件：索引与源码文件一并清理；源码已不存在时也算删除成功 */
export function removePlugin(id: string): boolean {
  const store = readStore()
  const stored = store.plugins.find((item) => item.id === id)
  if (!stored) return false
  writeStore({
    version: STORE_VERSION,
    plugins: store.plugins.filter((item) => item.id !== id)
  })
  const filePath = pluginSourcePath(id)
  if (existsSync(filePath)) rmSync(filePath, { force: true })
  return true
}

/**
 * 读取插件环境变量的完整取值（解密后的明文）。
 * 仅供主进程内部构造插件方法收到的 `env`，绝不跨 IPC 返回。
 */
export function readPluginEnvValues(id: string): PluginEnvValue {
  const stored = getStoredPlugin(id)
  if (!stored) throw new PluginError('notFound')
  const values: PluginEnvValue = {}
  for (const [key, encoded] of Object.entries(stored.envValues)) {
    values[key] = decodeSecret(
      encoded,
      () =>
        new PluginError(
          'envMissing',
          `已保存的环境变量无法解密，请在设置 → 账号设置中重新填写（${stored.name} · ${key}）`
        )
    )
  }
  return values
}

/** 保存环境变量：只覆盖草稿里非空且在声明表内的项，其余保持原值 */
export function savePluginEnv(id: string, draft: PluginEnvDraft): StoredPlugin {
  const store = readStore()
  const stored = store.plugins.find((item) => item.id === id)
  if (!stored) throw new PluginError('notFound')
  const values: PluginEnvValue = { ...stored.envValues }
  for (const field of stored.envFields) {
    const value = draft.values[field.key]
    if (typeof value !== 'string' || value.length === 0) continue
    values[field.key] = encodeSecret(value, `plugin:${id}`)
  }
  const next: StoredPlugin = {
    ...stored,
    envValues: normalizeEnvValues(stored.envFields, values),
    updatedAt: Date.now()
  }
  writeStore({
    version: STORE_VERSION,
    plugins: store.plugins.map((item) => (item.id === id ? next : item))
  })
  return next
}

/** 渲染层可见的插件摘要：不含源码、不含环境变量明文 */
export function toPluginSummary(stored: StoredPlugin, loadError: string): PluginSummary {
  const filled = readEnvFilledMask(stored.envFields, stored.envValues)
  return {
    id: stored.id,
    name: stored.name,
    version: stored.version,
    author: stored.author,
    description: stored.description,
    enabled: stored.enabled,
    filePath: pluginSourcePath(stored.id),
    hasEnv: stored.envFields.length > 0,
    envReady: isEnvReady(stored.envFields, filled),
    loadError
  }
}

/** 「是否已填写」掩码，渲染层只据此渲染「已保存，留空保持不变」 */
export function readEnvFilled(id: string): Record<string, boolean> {
  const stored = getStoredPlugin(id)
  if (!stored) throw new PluginError('notFound')
  return readEnvFilledMask(stored.envFields, stored.envValues)
}
