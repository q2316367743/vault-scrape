import { ipcRenderer } from 'electron'
import type {
  PluginAsset,
  PluginEnvDraft,
  PluginEnvSnapshot,
  PluginImportResult,
  PluginKind,
  PluginLegacyNotice,
  PluginMovieCandidate,
  PluginMovieDetail,
  PluginResult,
  PluginSummary,
  PluginTranslateRequest,
  PluginTranslateResult
} from '@common/types/plugin'
import { PLUGIN_LEGACY_CHANNEL, channelsOf } from './pluginChannels'

/**
 * 插件模块桥：**每个类别一个桥**（`movie` / `actor` / `translate`），
 * 各自走自己的通道，互不影响。
 *
 * 契约：所有 invoke 都返回 `PluginResult` 信封而**不抛异常**；
 * 参数统一打包成对象，主进程按 unknown 逐字段收窄。
 */
export interface PluginBridge {
  list: () => Promise<PluginResult<PluginSummary[]>>
  readCode: (id: string) => Promise<PluginResult<string>>
  saveCode: (id: string, code: string) => Promise<PluginResult<PluginSummary>>
  import: (overwrite?: boolean) => Promise<PluginResult<PluginImportResult>>
  remove: (id: string) => Promise<PluginResult<boolean>>
  setEnabled: (id: string, enabled: boolean) => Promise<PluginResult<PluginSummary>>
  reorder: (ids: string[]) => Promise<PluginResult<PluginSummary[]>>
  getEnv: (id: string) => Promise<PluginResult<PluginEnvSnapshot>>
  saveEnv: (id: string, draft: PluginEnvDraft) => Promise<PluginResult<PluginSummary>>
}

function createBridge(kind: PluginKind): PluginBridge {
  const channels = channelsOf(kind)
  return {
    list: () => ipcRenderer.invoke(channels.list),
    readCode: (id) => ipcRenderer.invoke(channels.readCode, { id }),
    saveCode: (id, code) => ipcRenderer.invoke(channels.saveCode, { id, code }),
    import: (overwrite = false) => ipcRenderer.invoke(channels.import, { overwrite }),
    remove: (id) => ipcRenderer.invoke(channels.remove, { id }),
    setEnabled: (id, enabled) => ipcRenderer.invoke(channels.setEnabled, { id, enabled }),
    reorder: (ids) => ipcRenderer.invoke(channels.reorder, { ids }),
    getEnv: (id) => ipcRenderer.invoke(channels.getEnv, { id }),
    saveEnv: (id, draft) => ipcRenderer.invoke(channels.saveEnv, { id, draft })
  }
}

/**
 * 影片信息插件桥：四个调用快捷方法（工具页的「插件测试」用）。
 * 演员桥不额外暴露方法：演员调用由主进程的刮削链路直接完成，界面不直接调。
 */
function createMovieBridge() {
  const base = createBridge('movie')
  const channels = channelsOf('movie')
  return {
    ...base,
    search: (id: string, keyword: string): Promise<PluginResult<PluginMovieCandidate[]>> =>
      ipcRenderer.invoke(channels.invoke, { id, method: 'search', keyword }),
    detail: (id: string, movieId: string): Promise<PluginResult<PluginMovieDetail>> =>
      ipcRenderer.invoke(channels.invoke, { id, method: 'detail', movieId }),
    covers: (id: string, movieId: string): Promise<PluginResult<PluginAsset[]>> =>
      ipcRenderer.invoke(channels.invoke, { id, method: 'covers', movieId }),
    extras: (id: string, movieId: string): Promise<PluginResult<PluginAsset[]>> =>
      ipcRenderer.invoke(channels.invoke, { id, method: 'extras', movieId })
  }
}

/**
 * 翻译插件桥：一个调用快捷方法，入参是 `{ text, from?, to }`。
 * 翻译目前没有业务调用方，方法先备着，等有调用方时不用再改这一层。
 */
function createTranslateBridge() {
  const base = createBridge('translate')
  const channels = channelsOf('translate')
  return {
    ...base,
    translate: (
      id: string,
      request: PluginTranslateRequest
    ): Promise<PluginResult<PluginTranslateResult>> =>
      ipcRenderer.invoke(channels.invoke, { id, method: 'translate', ...request })
  }
}

export const pluginApi = {
  /** 影片信息插件：搜索 / 详情 / 封面 / 花絮 */
  movie: createMovieBridge(),
  /** 演员信息插件：演员资料与头像图集 */
  actor: createBridge('actor'),
  /** 翻译插件：文本进、译文出 */
  translate: createTranslateBridge(),
  /** 旧版平铺插件目录的残留检查（插件页提示用） */
  legacy: (): Promise<PluginResult<PluginLegacyNotice>> =>
    ipcRenderer.invoke(PLUGIN_LEGACY_CHANNEL)
}

export type PluginApi = typeof pluginApi

/** 影片信息插件桥的完整形状（含四个调用快捷方法），供渲染层组合式声明类型 */
export type MoviePluginApi = ReturnType<typeof createMovieBridge>

/** 翻译插件桥的完整形状（含 translate 调用快捷方法） */
export type TranslatePluginApi = ReturnType<typeof createTranslateBridge>
