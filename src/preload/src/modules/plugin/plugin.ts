import { ipcRenderer } from 'electron'
import type {
  PluginAsset,
  PluginEnvDraft,
  PluginEnvSnapshot,
  PluginImportResult,
  PluginMovieCandidate,
  PluginMovieDetail,
  PluginResult,
  PluginSummary
} from '@common/types/plugin'
import { PluginChannels } from './pluginChannels'

/**
 * 插件模块桥。
 *
 * 契约：所有 invoke 都返回 `PluginResult` 信封而**不抛异常**；
 * 参数统一打包成对象，主进程按 unknown 逐字段收窄。
 */
export const pluginApi = {
  list: (): Promise<PluginResult<PluginSummary[]>> => ipcRenderer.invoke(PluginChannels.list),

  readCode: (id: string): Promise<PluginResult<string>> =>
    ipcRenderer.invoke(PluginChannels.readCode, { id }),

  saveCode: (id: string, code: string): Promise<PluginResult<PluginSummary>> =>
    ipcRenderer.invoke(PluginChannels.saveCode, { id, code }),

  import: (overwrite = false): Promise<PluginResult<PluginImportResult>> =>
    ipcRenderer.invoke(PluginChannels.import, { overwrite }),

  remove: (id: string): Promise<PluginResult<boolean>> =>
    ipcRenderer.invoke(PluginChannels.remove, { id }),

  setEnabled: (id: string, enabled: boolean): Promise<PluginResult<PluginSummary>> =>
    ipcRenderer.invoke(PluginChannels.setEnabled, { id, enabled }),

  getEnv: (id: string): Promise<PluginResult<PluginEnvSnapshot>> =>
    ipcRenderer.invoke(PluginChannels.getEnv, { id }),

  saveEnv: (id: string, draft: PluginEnvDraft): Promise<PluginResult<PluginSummary>> =>
    ipcRenderer.invoke(PluginChannels.saveEnv, { id, draft }),

  search: (id: string, keyword: string): Promise<PluginResult<PluginMovieCandidate[]>> =>
    ipcRenderer.invoke(PluginChannels.invoke, { id, method: 'search', keyword }),

  detail: (id: string, movieId: string): Promise<PluginResult<PluginMovieDetail>> =>
    ipcRenderer.invoke(PluginChannels.invoke, { id, method: 'detail', movieId }),

  covers: (id: string, movieId: string): Promise<PluginResult<PluginAsset[]>> =>
    ipcRenderer.invoke(PluginChannels.invoke, { id, method: 'covers', movieId }),

  extras: (id: string, movieId: string): Promise<PluginResult<PluginAsset[]>> =>
    ipcRenderer.invoke(PluginChannels.invoke, { id, method: 'extras', movieId })
}

export type PluginApi = typeof pluginApi
