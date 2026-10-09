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
  comparePluginVersion,
  describePluginError,
  readEnvFilledMask,
  type PluginEnvDraft,
  type PluginEnvField,
  type PluginEnvSnapshot,
  type PluginImportFailure,
  type PluginImportResult,
  type PluginImportSkipped,
  type PluginInvokeData,
  type PluginInvokePayload,
  type PluginMeta,
  type PluginMethod,
  type PluginSummary
} from '@common/types/plugin'
import type { LogLevel } from '@common/types/log'
import { appendLog } from '$/db/repo/logRepo'
import { loadSetting } from '$/modules/setting/settingStore'
import { BUILTIN_PLUGINS, findBuiltinPlugin } from './builtinPlugins'
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
  ensureBuiltinPlugin,
  getStoredPlugin,
  listStoredPlugins,
  pluginSourcePath,
  readPluginEnvValues,
  readPluginFile,
  readPluginSource,
  readEnvFilled,
  removePlugin,
  reorderPlugins as reorderStoredPlugins,
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

let builtinsReady = false

/** 幂等补齐内置插件索引记录；没有源码文件，因此只走索引 */
function ensureBuiltinPlugins(): void {
  if (builtinsReady) return
  builtinsReady = true
  for (const builtin of BUILTIN_PLUGINS) {
    try {
      ensureBuiltinPlugin({ meta: builtin.meta, envFields: builtin.env })
    } catch (error) {
      builtinsReady = false
      console.error('[plugin] 内置插件索引写入失败', describePluginError(error).message)
    }
  }
}

function fieldsEqual(a: readonly PluginEnvField[], b: readonly PluginEnvField[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** 取插件记录：先确保内置插件已入索引，再查索引 */
function storedPlugin(id: string): StoredPlugin | null {
  ensureBuiltinPlugins()
  return getStoredPlugin(id)
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
  if (!stored.builtin) {
    try {
      ensureCompiled(stored.id)
      loadErrors.delete(stored.id)
    } catch (error) {
      loadErrors.set(stored.id, describePluginError(error).message)
    }
  }
  const fresh = getStoredPlugin(stored.id) ?? stored
  return toPluginSummary(fresh, loadErrors.get(stored.id) ?? '')
}

export function listPluginSummaries(): PluginSummary[] {
  ensureBuiltinPlugins()
  return listStoredPlugins().map((stored) => loadSummary(stored))
}

/** 按渲染层给出的 ID 顺序重排插件；返回重排后的完整摘要列表 */
export function reorderPlugins(ids: string[]): PluginSummary[] {
  ensureBuiltinPlugins()
  reorderStoredPlugins(ids)
  return listPluginSummaries()
}

export function readPluginCode(id: string): string {
  if (storedPlugin(id)?.builtin) {
    throw new PluginError('notFound', '内置插件没有可编辑的源码')
  }
  return readPluginSource(id)
}

/** 保存源码：先编译校验通过才落盘，`meta.id` 必须与当前插件一致 */
export function savePluginCode(id: string, code: string): PluginSummary {
  const stored = storedPlugin(id)
  if (!stored) throw new PluginError('notFound', `插件 ${id} 不存在`)
  if (stored.builtin) throw new PluginError('unsupported', `插件 ${stored.name} 是内置插件，不可编辑源码`)
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

/** 批内候选：编译结果 + 源文件 mtime（同版本时用于排序） */
interface ImportCandidate {
  filePath: string
  source: string
  compiled: CompiledPlugin
  flush: (id: string) => void
  mtimeMs: number
}

/** 读源文件 mtime；读不到时按 0 处理，不影响导入成败 */
function fileMtime(filePath: string): number {
  try {
    return statSync(filePath).mtimeMs
  } catch {
    return 0
  }
}

/** 批内择优：版本高者胜；版本相同取 mtime 更大者；两者都相同则由先选中者保持胜出 */
function isNewerCandidate(candidate: ImportCandidate, current: ImportCandidate): boolean {
  const byVersion = comparePluginVersion(
    candidate.compiled.meta.version,
    current.compiled.meta.version
  )
  if (byVersion !== 0) return byVersion > 0
  return candidate.mtimeMs > current.mtimeMs
}

/**
 * 批量导入本机插件文件：逐个文件独立成败。
 *
 * 契约：
 * 1. 同名（`meta.id`）只保留最新：先比 `meta.version`，版本相同再比源文件 mtime，批内落选者进 `skipped`；
 * 2. 与本机已安装记录比较：严格更新时自动覆盖（store 保留原启停状态与环境变量），更旧时跳过并进 `skipped`；
 * 3. 版本相同且未开启 `overwrite` 时仍以 `duplicate` 失败，由渲染层确认后重试；
 * 4. 内置插件不参与版本比较，一律交给 store 抛 `unsupported`；
 * 5. `skipped` 是非错误语义，与 `failed` 分开返回。
 */
export function importPluginFiles(paths: readonly string[], overwrite: boolean): PluginImportResult {
  const imported: PluginSummary[] = []
  const skipped: PluginImportSkipped[] = []
  const failed: PluginImportFailure[] = []

  function skip(filePath: string, meta: PluginMeta, keptVersion: string, message: string): void {
    skipped.push({ filePath, id: meta.id, name: meta.name, keptVersion, message })
    appendLog({
      level: 'info',
      scope: `plugin:${meta.id}`,
      message: `已跳过旧版本插件：${basename(filePath)}`
    })
  }

  // 第一步：逐文件读取并编译，按 id 在批内择优，落选者当场记入 skipped
  const winners = new Map<string, ImportCandidate>()
  for (const filePath of paths) {
    try {
      const source = readPluginFile(filePath)
      const { compiled, flush } = compileImported(source, basename(filePath))
      const candidate: ImportCandidate = {
        filePath,
        source,
        compiled,
        flush,
        mtimeMs: fileMtime(filePath)
      }
      const current = winners.get(compiled.meta.id)
      if (current && isNewerCandidate(candidate, current)) {
        winners.set(compiled.meta.id, candidate)
        skip(
          current.filePath,
          current.compiled.meta,
          compiled.meta.version,
          `同批中已保留更新的版本 v${compiled.meta.version}`
        )
        continue
      }
      if (current) {
        skip(
          filePath,
          compiled.meta,
          current.compiled.meta.version,
          `同批中已保留更新的版本 v${current.compiled.meta.version}`
        )
        continue
      }
      winners.set(compiled.meta.id, candidate)
    } catch (error) {
      const { code, message } = describePluginError(error)
      failed.push({ filePath, code, message })
    }
  }

  // 第二步：胜者与本机已安装记录比对后落盘
  for (const candidate of winners.values()) {
    const meta = candidate.compiled.meta
    const installed = getStoredPlugin(meta.id)
    const replaceable = installed !== null && !installed.builtin
    if (installed !== null && !installed.builtin) {
      const byVersion = comparePluginVersion(meta.version, installed.version)
      if (byVersion < 0) {
        skip(candidate.filePath, meta, installed.version, `本机已安装更新的版本 v${installed.version}`)
        continue
      }
      if (byVersion === 0 && !overwrite) {
        failed.push({
          filePath: candidate.filePath,
          code: 'duplicate',
          message: `插件 ${meta.id} 已存在，请确认是否覆盖`
        })
        continue
      }
    }
    try {
      const next = writePluginSource(
        candidate.source,
        { meta, envFields: candidate.compiled.env },
        { overwrite: overwrite || replaceable }
      )
      cache.set(meta.id, { compiled: candidate.compiled, mtimeMs: sourceMtime(meta.id) })
      loadErrors.delete(meta.id)
      candidate.flush(meta.id)
      imported.push(toPluginSummary(next, ''))
      appendLog({
        level: 'info',
        scope: `plugin:${meta.id}`,
        message: `已导入插件：${basename(candidate.filePath)}`
      })
    } catch (error) {
      const { code, message } = describePluginError(error)
      failed.push({ filePath: candidate.filePath, code, message })
    }
  }

  return { imported, skipped, failed }
}

export function removePluginById(id: string): boolean {
  ensureBuiltinPlugins()
  const removed = removePlugin(id)
  cache.delete(id)
  loadErrors.delete(id)
  return removed
}

export function setEnabled(id: string, enabled: boolean): PluginSummary {
  ensureBuiltinPlugins()
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
  return storedPlugin(id)
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
  const stored = storedPlugin(id)
  if (!stored) throw new PluginError('notFound', `插件 ${id} 不存在`)
  if (!stored.enabled) throw new PluginError('invokeFailed', `插件 ${stored.name} 已停用，请先启用`)
  const argument = (method === 'search' ? payload.keyword : payload.movieId)?.trim() ?? ''
  if (argument.length === 0) {
    throw new PluginError(
      'invalidArgument',
      method === 'search' ? '缺少搜索关键字 keyword' : '缺少影片 ID movieId'
    )
  }
  const builtin = findBuiltinPlugin(id)
  if (builtin) {
    const data = await invokeWithTimeout(() => builtin.invoke(method, argument), {
      id,
      method,
      timeoutMs: callTimeoutMs(),
      log: createPluginLogSink(id)
    })
    appendLog({ level: 'info', scope: `plugin:${id}`, message: `${method} 调用完成` })
    return data
  }
  const compiled = ensureCompiled(id)
  const env = readPluginEnvValues(id)
  const missing = describeMissingEnv(compiled.env, readEnvFilledMask(compiled.env, env))
  if (missing.length > 0) {
    throw new PluginError('envMissing', `请先补全插件环境变量：${missing}`)
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
