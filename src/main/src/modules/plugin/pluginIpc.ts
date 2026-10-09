/**
 * 插件模块的 IPC 注册。
 *
 * 契约：
 * 1. 注册表在 main 内部抛 `PluginError`，**只有 IPC 边界做信封转换**；
 * 2. 入参来自渲染层，一律按 unknown 收窄后才交给注册表；
 * 3. `import` 的系统文件选择框由主进程弹出，渲染层只负责触发与展示结果。
 */
import { dialog, ipcMain } from 'electron'
import {
  PLUGIN_METHODS,
  PluginError,
  describePluginError,
  pluginFail,
  pluginOk,
  type PluginEnvDraft,
  type PluginImportResult,
  type PluginInvokeData,
  type PluginInvokePayload,
  type PluginMethod,
  type PluginResult,
  type PluginSummary
} from '@common/types/plugin'
import { readBoolean, readString, toSource } from '@common/types/setting/shared'
import { PluginChannels } from '~/modules/plugin/pluginChannels'
import {
  importPluginFiles,
  invokePlugin,
  listPluginSummaries,
  readPluginCode,
  readPluginEnv,
  removePluginById,
  reorderPlugins,
  saveEnv,
  savePluginCode,
  setEnabled
} from './pluginRegistry'

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
  const matched = PLUGIN_METHODS.find((item) => item === method)
  if (!matched) throw new PluginError('invalidArgument', `未知的插件方法：${method || '（空）'}`)
  return matched
}

function readInvokePayload(payload: unknown): PluginInvokePayload {
  const source = payloadOf(payload)
  const result: PluginInvokePayload = {}
  const keyword = readString(source, 'keyword', '')
  const movieId = readString(source, 'movieId', '')
  if (keyword.length > 0) result.keyword = keyword
  if (movieId.length > 0) result.movieId = movieId
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
async function importFromDialog(overwrite: boolean): Promise<PluginImportResult> {
  const result = await dialog.showOpenDialog({
    title: '选择插件脚本（可多选）',
    buttonLabel: '导入',
    filters: [{ name: '插件脚本', extensions: ['js'] }],
    properties: ['openFile', 'multiSelections']
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { imported: [], skipped: [], failed: [] }
  }
  return importPluginFiles(result.filePaths, overwrite)
}

export function registerPluginIpc(): void {
  ipcMain.handle(PluginChannels.list, () => handle<PluginSummary[]>(() => listPluginSummaries()))

  ipcMain.handle(PluginChannels.readCode, (_event, payload: unknown) =>
    handle<string>(() => readPluginCode(readId(payload)))
  )

  ipcMain.handle(PluginChannels.saveCode, (_event, payload: unknown) => {
    const source = payloadOf(payload)
    const id = readId(payload)
    return handle<PluginSummary>(() => savePluginCode(id, readString(source, 'code', '')))
  })

  ipcMain.handle(PluginChannels.import, (_event, payload: unknown) =>
    handle<PluginImportResult>(() =>
      importFromDialog(readBoolean(payloadOf(payload), 'overwrite', false))
    )
  )

  ipcMain.handle(PluginChannels.remove, (_event, payload: unknown) =>
    handle<boolean>(() => removePluginById(readId(payload)))
  )

  ipcMain.handle(PluginChannels.setEnabled, (_event, payload: unknown) => {
    const source = payloadOf(payload)
    const id = readId(payload)
    return handle<PluginSummary>(() => setEnabled(id, readBoolean(source, 'enabled', false)))
  })

  ipcMain.handle(PluginChannels.reorder, (_event, payload: unknown) =>
    handle<PluginSummary[]>(() => reorderPlugins(readIds(payload)))
  )

  ipcMain.handle(PluginChannels.getEnv, (_event, payload: unknown) =>
    handle(() => readPluginEnv(readId(payload)))
  )

  ipcMain.handle(PluginChannels.saveEnv, (_event, payload: unknown) => {
    const id = readId(payload)
    return handle<PluginSummary>(() => saveEnv(id, readEnvDraft(payload)))
  })

  ipcMain.handle(PluginChannels.invoke, (_event, payload: unknown) => {
    const id = readId(payload)
    const method = readMethod(payload)
    return handle<PluginInvokeData>(() => invokePlugin(id, method, readInvokePayload(payload)))
  })
}
