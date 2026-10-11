/**
 * 插件注册表工厂：**每个类别一份**编译缓存、加载错误记录与对外操作入口。
 *
 * 契约：
 * 1. 源码按修改时间缓存编译结果，文件被外部改动后下一次调用自动重编译；
 * 2. 调用前校验启停状态、方法是否属于该类别、必填环境变量，缺失一律抛 `envMissing`；
 * 3. 编译或调用失败只影响该插件：`list` 会把失败原因放进 `loadError`，不抛给渲染层；
 * 4. 所有方法都可能抛 `PluginError`，信封转换只发生在 IPC 边界；
 * 5. 类别之间互不可见：影片方法不会出现在演员注册表里，反之亦然（同一 id 可各存一份）。
 */
import { statSync } from 'node:fs'
import { basename } from 'node:path'
import {
  PLUGIN_KIND_LABELS,
  PLUGIN_KIND_METHODS,
  PluginError,
  comparePluginVersion,
  describePluginError,
  readEnvFilledMask,
  type PluginEnvDraft,
  type PluginEnvField,
  type PluginEnvSnapshot,
  type PluginImportResult,
  type PluginInvokeData,
  type PluginInvokePayload,
  type PluginKind,
  type PluginMethod,
  type PluginSummary
} from '@common/types/plugin'
import { appendLog } from '$/db/repo/logRepo'
import { loadSetting } from '$/modules/setting/settingStore'
import { findBuiltinPlugin, listBuiltinPlugins } from './builtinPlugins'
import { preparePluginImport } from './pluginImport'
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
  readEnvFilled,
  readPluginEnvValues,
  readPluginSource,
  removePlugin,
  reorderStoredPlugins,
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

function fieldsEqual(a: readonly PluginEnvField[], b: readonly PluginEnvField[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
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

/** 方法入参：搜索用关键字，演员钩子用姓名，其余用影片 ID */
function argumentOf(method: PluginMethod, payload: PluginInvokePayload): string {
  if (method === 'search') return payload.keyword?.trim() ?? ''
  if (method === 'actor' || method === 'actorAssets') return payload.actorName?.trim() ?? ''
  return payload.movieId?.trim() ?? ''
}

function describeMissingArgument(method: PluginMethod): string {
  if (method === 'search') return '缺少搜索关键字 keyword'
  if (method === 'actor' || method === 'actorAssets') return '缺少演员姓名 actorName'
  return '缺少影片 ID movieId'
}

/**
 * 创建某个类别的插件注册表。
 *
 * 返回的对象就是这个类别的全部对外能力：IPC、演员刮削链路与影片刮削链路
 * 各自持有对应的实例（见 `./pluginRegistries`）。
 */
export function createPluginRegistry(kind: PluginKind) {
  /** 编译缓存：id -> 编译结果 + 当时的源码修改时间 */
  const cache = new Map<string, CacheEntry>()
  /** 最近一次加载失败原因：id -> 文案 */
  const loadErrors = new Map<string, string>()
  let builtinsReady = false

  function sourceMtime(id: string): number {
    try {
      return statSync(pluginSourcePath(kind, id)).mtimeMs
    } catch {
      return 0
    }
  }

  /** 幂等补齐该类别的内置插件索引记录；内置插件没有源码文件，因此只走索引 */
  function ensureBuiltinPlugins(): void {
    if (builtinsReady) return
    builtinsReady = true
    for (const builtin of listBuiltinPlugins(kind)) {
      try {
        ensureBuiltinPlugin(kind, { meta: builtin.meta, envFields: builtin.env })
      } catch (error) {
        builtinsReady = false
        console.error(
          `[plugin] ${kind} 内置插件索引写入失败`,
          describePluginError(error).message
        )
      }
    }
  }

  /** 取插件记录：先确保内置插件已入索引，再查索引 */
  function storedPlugin(id: string): StoredPlugin | null {
    ensureBuiltinPlugins()
    return getStoredPlugin(kind, id)
  }

  /** 取编译结果；源码不存在、语法错误、缺少方法等都会抛 `PluginError` */
  function ensureCompiled(id: string): CompiledPlugin {
    const stored = getStoredPlugin(kind, id)
    if (!stored) throw new PluginError('notFound', `插件 ${id} 不存在`)
    const mtimeMs = sourceMtime(id)
    const cached = cache.get(id)
    if (cached && cached.mtimeMs === mtimeMs) return cached.compiled
    const source = readPluginSource(kind, id)
    const compiled = compilePlugin(kind, source, createPluginLogSink(kind, id), `${id}.js`)
    cache.set(id, { compiled, mtimeMs })
    if (!fieldsEqual(stored.envFields, compiled.env)) {
      cachePluginEnvFields(kind, id, compiled.env)
    }
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
    const fresh = getStoredPlugin(kind, stored.id) ?? stored
    return toPluginSummary(kind, fresh, loadErrors.get(stored.id) ?? '')
  }

  function listPluginSummaries(): PluginSummary[] {
    ensureBuiltinPlugins()
    return listStoredPlugins(kind).map((stored) => loadSummary(stored))
  }

  /** 按渲染层给出的 ID 顺序重排插件；返回重排后的完整摘要列表 */
  function reorderPlugins(ids: string[]): PluginSummary[] {
    ensureBuiltinPlugins()
    reorderStoredPlugins(kind, ids)
    return listPluginSummaries()
  }

  function readPluginCode(id: string): string {
    if (storedPlugin(id)?.builtin) {
      throw new PluginError('notFound', '内置插件没有可编辑的源码')
    }
    return readPluginSource(kind, id)
  }

  /** 保存源码：先编译校验通过才落盘，`meta.id` 与类别都必须与当前插件一致 */
  function savePluginCode(id: string, code: string): PluginSummary {
    const stored = storedPlugin(id)
    if (!stored) throw new PluginError('notFound', `插件 ${id} 不存在`)
    if (stored.builtin) {
      throw new PluginError('unsupported', `插件 ${stored.name} 是内置插件，不可编辑源码`)
    }
    if (Buffer.byteLength(code, 'utf-8') > PLUGIN_SOURCE_LIMIT_BYTES) {
      throw new PluginError(
        'invalidPlugin',
        `插件源码超过 ${Math.floor(PLUGIN_SOURCE_LIMIT_BYTES / 1024)} KB 上限`
      )
    }
    const compiled = compilePlugin(kind, code, createPluginLogSink(kind, id), `${id}.js`)
    if (compiled.meta.id !== id) {
      throw new PluginError(
        'invalidPlugin',
        `插件 meta.id 必须与当前插件一致（期望 ${id}，实际 ${compiled.meta.id}）`
      )
    }
    const next = writePluginSource(
      kind,
      code,
      { meta: compiled.meta, envFields: compiled.env },
      { overwrite: true }
    )
    cache.set(id, { compiled, mtimeMs: sourceMtime(id) })
    loadErrors.delete(id)
    return toPluginSummary(kind, next, '')
  }

  /**
   * 批量导入本机插件文件：逐个文件独立成败。
   *
   * 契约：
   * 1. 同名（`meta.id`）只保留最新：先比 `meta.version`，版本相同再比源文件 mtime，批内落选者进 `skipped`；
   * 2. 与本机已安装记录比较：严格更新时自动覆盖（store 保留原启停状态与环境变量），更旧时跳过并进 `skipped`；
   * 3. 版本相同且未开启 `overwrite` 时仍以 `duplicate` 失败，由渲染层确认后重试；
   * 4. 文件声明的类别与目标类别不符时，编译阶段就按 `invalidPlugin` 失败，不会写进别的类别；
   * 5. 内置插件不参与版本比较，一律交给 store 抛 `unsupported`；
   * 6. `skipped` 是非错误语义，与 `failed` 分开返回。
   */
  function importPluginFiles(
    paths: readonly string[],
    overwrite: boolean
  ): PluginImportResult {
    const prepared = preparePluginImport(kind, paths)
    const imported: PluginSummary[] = []
    const skipped = prepared.skipped
    const failed = prepared.failed

    for (const candidate of prepared.winners) {
      const meta = candidate.compiled.meta
      const installed = getStoredPlugin(kind, meta.id)
      const replaceable = installed !== null && !installed.builtin
      if (installed !== null && !installed.builtin) {
        const byVersion = comparePluginVersion(meta.version, installed.version)
        if (byVersion < 0) {
          skipped.push({
            filePath: candidate.filePath,
            id: meta.id,
            name: meta.name,
            keptVersion: installed.version,
            message: `本机已安装更新的版本 v${installed.version}`
          })
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
          kind,
          candidate.source,
          { meta, envFields: candidate.compiled.env },
          { overwrite: overwrite || replaceable }
        )
        cache.set(meta.id, { compiled: candidate.compiled, mtimeMs: sourceMtime(meta.id) })
        loadErrors.delete(meta.id)
        candidate.flush(meta.id)
        imported.push(toPluginSummary(kind, next, ''))
        appendLog({
          level: 'info',
          scope: `plugin:${kind}:${meta.id}`,
          message: `已导入插件：${basename(candidate.filePath)}`
        })
      } catch (error) {
        const { code, message } = describePluginError(error)
        failed.push({ filePath: candidate.filePath, code, message })
      }
    }

    return { imported, skipped, failed }
  }

  function removePluginById(id: string): boolean {
    ensureBuiltinPlugins()
    const removed = removePlugin(kind, id)
    cache.delete(id)
    loadErrors.delete(id)
    return removed
  }

  function setEnabled(id: string, enabled: boolean): PluginSummary {
    ensureBuiltinPlugins()
    return loadSummary(setPluginEnabled(kind, id, enabled))
  }

  /** 刷新环境变量声明表；编译失败时继续沿用落盘的旧声明表 */
  function refreshPluginEnvFields(id: string): StoredPlugin | null {
    try {
      ensureCompiled(id)
    } catch (error) {
      console.warn(
        `[plugin] ${kind} 插件编译失败，环境变量面板沿用上次声明表`,
        describePluginError(error).message
      )
    }
    return storedPlugin(id)
  }

  function readPluginEnv(id: string): PluginEnvSnapshot {
    const stored = refreshPluginEnvFields(id)
    if (!stored) throw new PluginError('notFound', `插件 ${id} 不存在`)
    return {
      fields: stored.envFields,
      filled: readEnvFilled(kind, id)
    }
  }

  function saveEnv(id: string, draft: PluginEnvDraft): PluginSummary {
    return loadSummary(savePluginEnv(kind, id, draft))
  }

  async function invokePlugin(
    id: string,
    method: PluginMethod,
    payload: PluginInvokePayload
  ): Promise<PluginInvokeData> {
    if (!PLUGIN_KIND_METHODS[kind].all.includes(method)) {
      throw new PluginError(
        'invalidArgument',
        `「${PLUGIN_KIND_LABELS[kind]}」插件不支持方法：${method}`
      )
    }
    const stored = storedPlugin(id)
    if (!stored) throw new PluginError('notFound', `插件 ${id} 不存在`)
    if (!stored.enabled) {
      throw new PluginError('invokeFailed', `插件 ${stored.name} 已停用，请先启用`)
    }
    const argument = argumentOf(method, payload)
    if (argument.length === 0) {
      throw new PluginError('invalidArgument', describeMissingArgument(method))
    }
    const builtin = findBuiltinPlugin(kind, id)
    if (builtin) {
      const data = await invokeWithTimeout(() => builtin.invoke(method, argument), {
        id,
        method,
        timeoutMs: callTimeoutMs(),
        log: createPluginLogSink(kind, id)
      })
      appendLog({ level: 'info', scope: `plugin:${kind}:${id}`, message: `${method} 调用完成` })
      return data
    }
    const compiled = ensureCompiled(id)
    const plugin = compiled.plugin
    const env = readPluginEnvValues(kind, id)
    const missing = describeMissingEnv(compiled.env, readEnvFilledMask(compiled.env, env))
    if (missing.length > 0) {
      throw new PluginError('envMissing', `请先补全插件环境变量：${missing}`)
    }
    const ctx = createPluginContext(kind, id)
    const task = (): Promise<PluginInvokeData> => {
      if (method === 'search') {
        if (!('search' in plugin)) throw new PluginError('invokeFailed', '插件未实现 search 方法')
        return plugin.search(argument, env, ctx)
      }
      if (method === 'detail') {
        if (!('detail' in plugin)) throw new PluginError('invokeFailed', '插件未实现 detail 方法')
        return plugin.detail(argument, env, ctx)
      }
      if (method === 'covers') {
        if (!('covers' in plugin)) throw new PluginError('invokeFailed', '插件未实现 covers 方法')
        return plugin.covers(argument, env, ctx)
      }
      if (method === 'extras') {
        if (!('extras' in plugin)) throw new PluginError('invokeFailed', '插件未实现 extras 方法')
        return plugin.extras(argument, env, ctx)
      }
      if (method === 'actor') {
        if (!('actor' in plugin)) throw new PluginError('invokeFailed', '插件未实现 actor 方法')
        return plugin.actor(argument, env, ctx)
      }
      if (!('actorAssets' in plugin) || !plugin.actorAssets) {
        throw new PluginError('invokeFailed', `插件 ${stored.name} 未实现演员图集方法`)
      }
      return plugin.actorAssets(argument, env, ctx)
    }
    const data = await invokeWithTimeout(task, {
      id,
      method,
      timeoutMs: callTimeoutMs(),
      log: createPluginLogSink(kind, id)
    })
    appendLog({ level: 'info', scope: `plugin:${kind}:${id}`, message: `${method} 调用完成` })
    return data
  }

  return {
    listPluginSummaries,
    reorderPlugins,
    readPluginCode,
    savePluginCode,
    importPluginFiles,
    removePluginById,
    setEnabled,
    readPluginEnv,
    saveEnv,
    invokePlugin
  }
}

/** 某个类别的插件注册表 */
export type PluginRegistry = ReturnType<typeof createPluginRegistry>
