/**
 * 插件模块的 IPC 注册：**每个类别注册一套通道**，另加一个全局的旧目录检查。
 *
 * 契约：
 * 1. 注册表在 main 内部抛 `PluginError`，**只有 IPC 边界做信封转换**；
 * 2. 入参来自渲染层，一律按 unknown 收窄后才交给注册表；
 * 3. `import` 的系统文件选择框由主进程弹出，渲染层只负责触发与展示结果；
 * 4. 导入时按 `meta.kind` 校验，文件声明的类别与当前页类别不一致会直接失败，不会串类别落盘。
 */
import { dialog, ipcMain } from 'electron'
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
import { PLUGIN_LEGACY_CHANNEL, channelsOf } from '~/modules/plugin/pluginChannels'
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

/** 渲染层提交的环境变量草稿：逐项收窄，字段级校验由类型层负责 */
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

/** 渲染层提交的插件顺序：只保留字符串项，其余丢弃 */
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
  const result = await dialog.showOpenDialog({
    title: '选择插件脚本（可多选）',
    buttonLabel: '导入',
    filters: [{ name: '插件脚本', extensions: ['js'] }],
    properties: ['openFile', 'multiSelections']
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { imported: [], skipped: [], failed: [] }
  }
  return registry.importPluginFiles(result.filePaths, overwrite)
}

/** 注册一个类别的全部通道；动作名与 preload 桥一一对应 */
function registerKind(kind: PluginKind): void {
  const registry = REGISTRIES[kind]
  const channels = channelsOf(kind)

  ipcMain.handle(channels.list, () =>
    handle<PluginSummary[]>(() => registry.listPluginSummaries())
  )

  ipcMain.handle(channels.readCode, (_event, payload: unknown) =>
    handle<string>(() => registry.readPluginCode(readId(payload)))
  )

  ipcMain.handle(channels.saveCode, (_event, payload: unknown) => {
    const source = payloadOf(payload)
    const id = readId(payload)
    return handle<PluginSummary>(() => registry.savePluginCode(id, readString(source, 'code', '')))
  })

  ipcMain.handle(channels.import, (_event, payload: unknown) =>
    handle<PluginImportResult>(() =>
      importFromDialog(registry, readBoolean(payloadOf(payload), 'overwrite', false))
    )
  )

  ipcMain.handle(channels.remove, (_event, payload: unknown) =>
    handle<boolean>(() => registry.removePluginById(readId(payload)))
  )

  ipcMain.handle(channels.setEnabled, (_event, payload: unknown) => {
    const source = payloadOf(payload)
    const id = readId(payload)
    return handle<PluginSummary>(() =>
      registry.setEnabled(id, readBoolean(source, 'enabled', false))
    )
  })

  ipcMain.handle(channels.reorder, (_event, payload: unknown) =>
    handle<PluginSummary[]>(() => registry.reorderPlugins(readIds(payload)))
  )

  ipcMain.handle(channels.getEnv, (_event, payload: unknown) =>
    handle(() => registry.readPluginEnv(readId(payload)))
  )

  ipcMain.handle(channels.saveEnv, (_event, payload: unknown) => {
    const id = readId(payload)
    return handle<PluginSummary>(() => registry.saveEnv(id, readEnvDraft(payload)))
  })

  ipcMain.handle(channels.invoke, (_event, payload: unknown) => {
    const id = readId(payload)
    const method = readMethod(payload)
    return handle<PluginInvokeData>(() =>
      registry.invokePlugin(id, method, readInvokePayload(payload))
    )
  })
}

export function registerPluginIpc(): void {
  for (const kind of PLUGIN_KINDS) registerKind(kind)
  ipcMain.handle(PLUGIN_LEGACY_CHANNEL, () =>
    handle<PluginLegacyNotice>(() => legacyPluginFiles())
  )
}
