/**
 * 插件域的 core API（影片 / 演员 / 翻译 / 存储四类共用一套动作）。
 *
 * 契约：
 * 1. 注册表在 core 内部抛 `PluginError`，**只有 API 边界做信封转换**；
 * 2. 入参来自窗口，一律按 unknown 收窄后才交给注册表；
 * 3. `import` 的系统文件选择框由 core 弹出；导入时按 `meta.kind` 校验，
 *    文件声明的类别与当前页类别不一致会直接失败，不会串类别落盘。
 */
import {
  PLUGIN_KINDS,
  PLUGIN_METHOD_NAMES,
  PluginError,
  describePluginError,
  pluginFail,
  pluginOk,
  type PluginEnvDraft,
  type PluginImportResult,
  type PluginInvokeData,
  type PluginInvokePayload,
  type PluginKind,
  type PluginLegacyNotice,
  type PluginMethod,
  type PluginResult,
  type PluginSummary
} from '@common/types/plugin'
import { readBoolean, readString, toSource } from '@common/types/setting/shared'
import { host } from '../../runtime/host'
import { actorPlugins, moviePlugins, storagePlugins, translatePlugins } from './pluginRegistries'
import { legacyPluginFiles } from './pluginStore'
import type { PluginRegistry } from './pluginRegistry'

const REGISTRIES: Readonly<Record<PluginKind, PluginRegistry>> = {
  movie: moviePlugins,
  actor: actorPlugins,
  translate: translatePlugins,
  storage: storagePlugins
}

function handle<T>(task: () => Promise<T> | T): Promise<PluginResult<T>> {
  return Promise.resolve()
    .then(task)
    .then((data) => pluginOk(data))
    .catch((error: unknown) => {
      const { code, message } = describePluginError(error)
      return pluginFail(code, message)
    })
}

function payloadOf(payload: unknown): Record<string, unknown> {
  return toSource(payload) ?? {}
}

function readKind(payload: unknown): PluginKind {
  const value = readString(payloadOf(payload), 'kind', '')
  const matched = PLUGIN_KINDS.find((kind) => kind === value)
  if (!matched) throw new PluginError('invalidArgument', '未知的插件类别')
  return matched
}

function registryOf(payload: unknown): PluginRegistry {
  return REGISTRIES[readKind(payload)]
}

function readId(payload: unknown): string {
  const id = readString(payloadOf(payload), 'id', '')
  if (id.length === 0) throw new PluginError('invalidArgument', '缺少插件 ID')
  return id
}

function readMethod(payload: unknown): PluginMethod {
  const method = readString(payloadOf(payload), 'method', '')
  const matched = PLUGIN_METHOD_NAMES.find((item) => item === method)
  if (!matched) throw new PluginError('invalidArgument', `未知的插件方法：${method || '（空）'}`)
  return matched
}

function readInvokePayload(payload: unknown): PluginInvokePayload {
  const source = payloadOf(payload)
  const result: PluginInvokePayload = {}
  const keyword = readString(source, 'keyword', '')
  const movieId = readString(source, 'movieId', '')
  const actorName = readString(source, 'actorName', '')
  const text = readString(source, 'text', '')
  const from = readString(source, 'from', '')
  const to = readString(source, 'to', '')
  if (keyword.length > 0) result.keyword = keyword
  if (movieId.length > 0) result.movieId = movieId
  if (actorName.length > 0) result.actorName = actorName
  if (text.length > 0) result.text = text
  if (from.length > 0) result.from = from
  if (to.length > 0) result.to = to
  return result
}

/** 窗口提交的环境变量草稿：逐项收窄，字段级校验由类型层负责 */
function readEnvDraft(payload: unknown): PluginEnvDraft {
  const source = toSource(payloadOf(payload).draft) ?? {}
  const values: Record<string, string> = {}
  const rawValues = toSource(source.values)
  if (rawValues) {
    for (const [key, value] of Object.entries(rawValues)) {
      if (typeof value === 'string') values[key] = value
    }
  }
  return { values }
}

/** 窗口提交的插件顺序：只保留字符串项，其余丢弃 */
function readIds(payload: unknown): string[] {
  const raw = payloadOf(payload).ids
  if (!Array.isArray(raw)) throw new PluginError('invalidArgument', '缺少插件顺序列表')
  return raw.filter((item): item is string => typeof item === 'string')
}

/** 弹出系统文件选择框并批量导入（可多选）；用户取消时返回空结果 */
async function importFromDialog(
  registry: PluginRegistry,
  overwrite: boolean
): Promise<PluginImportResult> {
  const filePaths = await host().dialog.open({
    title: '选择插件脚本（可多选）',
    filters: [{ name: '插件脚本', extensions: ['js'] }],
    multiple: true
  })
  if (filePaths.length === 0) {
    return { imported: [], skipped: [], failed: [] }
  }
  return registry.importPluginFiles(filePaths, overwrite)
}

export const pluginApi = {
  pluginList: (_ctx: unknown, payload: unknown): Promise<PluginResult<PluginSummary[]>> =>
    handle<PluginSummary[]>(() => registryOf(payload).listPluginSummaries()),

  pluginReadCode: (_ctx: unknown, payload: unknown): Promise<PluginResult<string>> =>
    handle<string>(() => registryOf(payload).readPluginCode(readId(payload))),

  pluginSaveCode: (_ctx: unknown, payload: unknown): Promise<PluginResult<PluginSummary>> =>
    handle<PluginSummary>(() =>
      registryOf(payload).savePluginCode(readId(payload), readString(payloadOf(payload), 'code', ''))
    ),

  pluginImport: (_ctx: unknown, payload: unknown): Promise<PluginResult<PluginImportResult>> =>
    handle<PluginImportResult>(() =>
      importFromDialog(registryOf(payload), readBoolean(payloadOf(payload), 'overwrite', false))
    ),

  pluginRemove: (_ctx: unknown, payload: unknown): Promise<PluginResult<boolean>> =>
    handle<boolean>(() => registryOf(payload).removePluginById(readId(payload))),

  pluginSetEnabled: (_ctx: unknown, payload: unknown): Promise<PluginResult<PluginSummary>> =>
    handle<PluginSummary>(() =>
      registryOf(payload).setEnabled(readId(payload), readBoolean(payloadOf(payload), 'enabled', false))
    ),

  pluginReorder: (_ctx: unknown, payload: unknown): Promise<PluginResult<PluginSummary[]>> =>
    handle<PluginSummary[]>(() => registryOf(payload).reorderPlugins(readIds(payload))),

  pluginGetEnv: (_ctx: unknown, payload: unknown): Promise<PluginResult<unknown>> =>
    handle(() => registryOf(payload).readPluginEnv(readId(payload))),

  pluginSaveEnv: (_ctx: unknown, payload: unknown): Promise<PluginResult<PluginSummary>> =>
    handle<PluginSummary>(() =>
      registryOf(payload).saveEnv(readId(payload), readEnvDraft(payload))
    ),

  pluginInvoke: (_ctx: unknown, payload: unknown): Promise<PluginResult<PluginInvokeData>> =>
    handle<PluginInvokeData>(() =>
      registryOf(payload).invokePlugin(readId(payload), readMethod(payload), readInvokePayload(payload))
    ),

  /** 旧版平铺插件目录的残留检查（插件页提示用） */
  pluginLegacy: (): Promise<PluginResult<PluginLegacyNotice>> =>
    handle<PluginLegacyNotice>(() => legacyPluginFiles())
}

export { PLUGIN_KINDS }
