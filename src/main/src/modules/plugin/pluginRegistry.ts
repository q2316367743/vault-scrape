/**
 * 插件注册表：编译缓存、加载错误记录与对外操作入口。
 *
 * 契约：
 * 1. 源码按修改时间缓存编译结果，文件被外部改动后下一次调用自动重编译；
 * 2. 调用前校验启停状态与必填环境变量，缺失一律抛 `envMissing`；
 * 3. 编译或调用失败只影响该插件：`list` 会把失败原因放进 `loadError`，不抛给渲染层；
 * 4. 所有方法都可能抛 `PluginError`，信封转换只发生在 IPC 边界。
 */
import { statSync } from 'node:fs'
import { basename } from 'node:path'
import {
  PluginError,
  describePluginError,
  readEnvFilledMask,
  type PluginEnvDraft,
  type PluginEnvField,
  type PluginEnvSnapshot,
  type PluginImportFailure,
  type PluginImportResult,
  type PluginInvokeData,
  type PluginInvokePayload,
  type PluginMethod,
  type PluginSummary
} from '@common/types/plugin'
import type { LogLevel } from '@common/types/log'
import { appendLog } from '$/db/repo/logRepo'
import { loadSetting } from '$/modules/setting/settingStore'
import { createPluginContext, createPluginLogSink } from './pluginHost'
import {
  PLUGIN_CALL_TIMEOUT_MS,
  compilePlugin,
  invokeWithTimeout,
  type CompiledPlugin
} from './pluginRuntime'
import {
  PLUGIN_SOURCE_LIMIT_BYTES,
  cachePluginEnvFields,
  getStoredPlugin,
  listStoredPlugins,
  pluginSourcePath,
  readPluginEnvValues,
  readPluginFile,
  readPluginSource,
  readEnvFilled,
  removePlugin,
  savePluginEnv,
  setPluginEnabled,
  toPluginSummary,
  writePluginSource,
  type StoredPlugin
} from './pluginStore'

interface CacheEntry {
  compiled: CompiledPlugin
  mtimeMs: number
}

interface BufferedLog {
  level: LogLevel
  message: string
  detail?: string
}

/** 编译缓存：id -> 编译结果 + 当时的源码修改时间 */
const cache = new Map<string, CacheEntry>()

/** 最近一次加载失败原因：id -> 文案 */
const loadErrors = new Map<string, string>()

function sourceMtime(id: string): number {
  try {
    return statSync(pluginSourcePath(id)).mtimeMs
  } catch {
    return 0
  }
}

function fieldsEqual(a: readonly PluginEnvField[], b: readonly PluginEnvField[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * 取编译结果；源码不存在、语法错误、缺少方法等都会抛 `PluginError`。
 */
function ensureCompiled(id: string): CompiledPlugin {
  const stored = getStoredPlugin(id)
  if (!stored) throw new PluginError('notFound', `插件 ${id} 不存在`)
  const mtimeMs = sourceMtime(id)
  const cached = cache.get(id)
  if (cached && cached.mtimeMs === mtimeMs) return cached.compiled
  const source = readPluginSource(id)
  const compiled = compilePlugin(source, createPluginLogSink(id), `${id}.js`)
  cache.set(id, { compiled, mtimeMs })
  if (!fieldsEqual(stored.envFields, compiled.env)) cachePluginEnvFields(id, compiled.env)
  return compiled
}

/** 生成摘要；编译失败时把原因写进 `loadError` 而不抛出 */
function loadSummary(stored: StoredPlugin): PluginSummary {
  try {
    ensureCompiled(stored.id)
    loadErrors.delete(stored.id)
  } catch (error) {
    loadErrors.set(stored.id, describePluginError(error).message)
  }
  const fresh = getStoredPlugin(stored.id) ?? stored
  return toPluginSummary(fresh, loadErrors.get(stored.id) ?? '')
}

export function listPluginSummaries(): PluginSummary[] {
  return listStoredPlugins().map((stored) => loadSummary(stored))
}

export function readPluginCode(id: string): string {
  return readPluginSource(id)
}

/** 保存源码：先编译校验通过才落盘，`meta.id` 必须与当前插件一致 */
export function savePluginCode(id: string, code: string): PluginSummary {
  const stored = getStoredPlugin(id)
  if (!stored) throw new PluginError('notFound', `插件 ${id} 不存在`)
  if (Buffer.byteLength(code, 'utf-8') > PLUGIN_SOURCE_LIMIT_BYTES) {
    throw new PluginError(
      'invalidPlugin',
      `插件源码超过 ${Math.floor(PLUGIN_SOURCE_LIMIT_BYTES / 1024)} KB 上限`
    )
  }
  const compiled = compilePlugin(code, createPluginLogSink(id), `${id}.js`)
  if (compiled.meta.id !== id) {
    throw new PluginError(
      'invalidPlugin',
      `插件 meta.id 必须与当前插件一致（期望 ${id}，实际 ${compiled.meta.id}）`
    )
  }
  const next = writePluginSource(
    code,
    { meta: compiled.meta, envFields: compiled.env },
    { overwrite: true }
  )
  cache.set(id, { compiled, mtimeMs: sourceMtime(id) })
  loadErrors.delete(id)
  return toPluginSummary(next, '')
}

/** 编译导入的源码，并把顶层 console 输出暂存到 id 确定后再落库 */
function compileImported(
  source: string,
  fileName: string
): { compiled: CompiledPlugin; flush: (id: string) => void } {
  const buffer: BufferedLog[] = []
  const compiled = compilePlugin(
    source,
    (level, message, detail) => {
      buffer.push({ level, message, detail })
    },
    fileName
  )
  return {
    compiled,
    flush: (id) => {
      const sink = createPluginLogSink(id)
      for (const item of buffer) sink(item.level, item.message, item.detail)
    }
  }
}

/**
 * 批量导入本机插件文件：逐个文件独立成败。
 *
 * 已存在同 ID 且 `overwrite` 为 false 时该项以 `duplicate` 失败，其余文件不受影响。
 */
export function importPluginFiles(
  paths: readonly string[],
  overwrite: boolean
): PluginImportResult {
  const imported: PluginSummary[] = []
  const failed: PluginImportFailure[] = []
  for (const filePath of paths) {
    try {
      const source = readPluginFile(filePath)
      const { compiled, flush } = compileImported(source, basename(filePath))
      const next = writePluginSource(
        source,
        { meta: compiled.meta, envFields: compiled.env },
        { overwrite }
      )
      cache.set(compiled.meta.id, { compiled, mtimeMs: sourceMtime(compiled.meta.id) })
      loadErrors.delete(compiled.meta.id)
      flush(compiled.meta.id)
      imported.push(toPluginSummary(next, ''))
      appendLog({
        level: 'info',
        scope: `plugin:${compiled.meta.id}`,
        message: `已导入插件：${basename(filePath)}`
      })
    } catch (error) {
      const { code, message } = describePluginError(error)
      failed.push({ filePath, code, message })
    }
  }
  return { imported, failed }
}

export function removePluginById(id: string): boolean {
  const removed = removePlugin(id)
  cache.delete(id)
  loadErrors.delete(id)
  return removed
}

export function setEnabled(id: string, enabled: boolean): PluginSummary {
  return loadSummary(setPluginEnabled(id, enabled))
}

/** 刷新环境变量声明表；编译失败时继续沿用落盘的旧声明表 */
export function refreshPluginEnvFields(id: string): StoredPlugin | null {
  try {
    ensureCompiled(id)
  } catch (error) {
    console.warn(
      '[plugin] 插件编译失败，环境变量面板沿用上次声明表',
      describePluginError(error).message
    )
  }
  return getStoredPlugin(id)
}

export function readPluginEnv(id: string): PluginEnvSnapshot {
  const stored = refreshPluginEnvFields(id)
  if (!stored) throw new PluginError('notFound', `插件 ${id} 不存在`)
  return {
    fields: stored.envFields,
    filled: readEnvFilled(id)
  }
}

export function saveEnv(id: string, draft: PluginEnvDraft): PluginSummary {
  return loadSummary(savePluginEnv(id, draft))
}

/** 调用超时：网络超时 × 重试次数 + 余量，且不低于默认下限 */
function callTimeoutMs(): number {
  const network = loadSetting().network
  const retries = Math.max(0, Math.floor(network.retryCount))
  return Math.max(PLUGIN_CALL_TIMEOUT_MS, network.timeout * (retries + 1) * 1000 + 5000)
}

function describeMissingEnv(
  fields: readonly PluginEnvField[],
  filled: Record<string, boolean>
): string {
  return fields
    .filter((field) => field.required === true && filled[field.key] !== true)
    .map((field) => field.label)
    .join('、')
}

export async function invokePlugin(
  id: string,
  method: PluginMethod,
  payload: PluginInvokePayload
): Promise<PluginInvokeData> {
  const stored = getStoredPlugin(id)
  if (!stored) throw new PluginError('notFound', `插件 ${id} 不存在`)
  if (!stored.enabled) throw new PluginError('invokeFailed', `插件 ${stored.name} 已停用，请先启用`)
  const compiled = ensureCompiled(id)
  const env = readPluginEnvValues(id)
  const missing = describeMissingEnv(compiled.env, readEnvFilledMask(compiled.env, env))
  if (missing.length > 0) {
    throw new PluginError('envMissing', `请先补全插件环境变量：${missing}`)
  }
  const argument = (method === 'search' ? payload.keyword : payload.movieId)?.trim() ?? ''
  if (argument.length === 0) {
    throw new PluginError(
      'invalidArgument',
      method === 'search' ? '缺少搜索关键字 keyword' : '缺少影片 ID movieId'
    )
  }
  const ctx = createPluginContext(id)
  const task = (): Promise<PluginInvokeData> => {
    if (method === 'search') return compiled.plugin.search(argument, env, ctx)
    if (method === 'detail') return compiled.plugin.detail(argument, env, ctx)
    if (method === 'covers') return compiled.plugin.covers(argument, env, ctx)
    return compiled.plugin.extras(argument, env, ctx)
  }
  const data = await invokeWithTimeout(task, {
    id,
    method,
    timeoutMs: callTimeoutMs(),
    log: createPluginLogSink(id)
  })
  appendLog({ level: 'info', scope: `plugin:${id}`, message: `${method} 调用完成` })
  return data
}
