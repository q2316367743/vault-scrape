/**
 * 插件模块桥：**每个类别一个桥**（movie / actor / translate / storage），
 * 分别走 `plugin:<类别>:*` 对应的 core 方法，互不影响。
 *
 * 契约：所有调用返回 `PluginResult` 信封；参数统一打包成对象，core 按 unknown 逐字段收窄。
 */
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
import { callCore } from './invoke'
import { runJob } from './job'

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
  return {
    list: () => callCore('pluginList', { kind }),
    readCode: (id) => callCore('pluginReadCode', { kind, id }),
    saveCode: (id, code) => callCore('pluginSaveCode', { kind, id, code }),
    import: (overwrite = false) => runJob('plugin.import', { kind, overwrite }),
    remove: (id) => callCore('pluginRemove', { kind, id }),
    setEnabled: (id, enabled) => callCore('pluginSetEnabled', { kind, id, enabled }),
    reorder: (ids) => callCore('pluginReorder', { kind, ids }),
    getEnv: (id) => callCore('pluginGetEnv', { kind, id }),
    saveEnv: (id, draft) => callCore('pluginSaveEnv', { kind, id, draft })
  }
}

/**
 * 影片信息插件桥：四个调用快捷方法（工具页的「插件测试」用）。
 * 演员桥不额外暴露方法：演员调用由 core 的刮削链路直接完成。
 */
function createMovieBridge() {
  const base = createBridge('movie')
  return {
    ...base,
    search: (id: string, keyword: string): Promise<PluginResult<PluginMovieCandidate[]>> =>
      runJob('plugin.invoke', { kind: 'movie', id, method: 'search', keyword }),
    detail: (id: string, movieId: string): Promise<PluginResult<PluginMovieDetail>> =>
      runJob('plugin.invoke', { kind: 'movie', id, method: 'detail', movieId }),
    covers: (id: string, movieId: string): Promise<PluginResult<PluginAsset[]>> =>
      runJob('plugin.invoke', { kind: 'movie', id, method: 'covers', movieId }),
    extras: (id: string, movieId: string): Promise<PluginResult<PluginAsset[]>> =>
      runJob('plugin.invoke', { kind: 'movie', id, method: 'extras', movieId })
  }
}

/** 翻译插件桥：试翻一条（插件页的调试入口） */
function createTranslateBridge() {
  const base = createBridge('translate')
  return {
    ...base,
    translate: (
      id: string,
      request: PluginTranslateRequest
    ): Promise<PluginResult<PluginTranslateResult>> =>
      runJob('plugin.invoke', { kind: 'translate', id, method: 'translate', ...request })
  }
}

export const pluginApi = {
  movie: createMovieBridge(),
  actor: createBridge('actor'),
  translate: createTranslateBridge(),
  storage: createBridge('storage'),
  /** 旧版平铺插件目录的残留检查（插件页提示用） */
  legacy: (): Promise<PluginResult<PluginLegacyNotice>> => callCore('pluginLegacy')
}

export type PluginApi = typeof pluginApi
export type MoviePluginApi = ReturnType<typeof createMovieBridge>
export type TranslatePluginApi = ReturnType<typeof createTranslateBridge>

/** 按类别取插件桥：页面以 kind 为参数复用同一套管理逻辑 */
export function pluginBridge(kind: PluginKind): PluginBridge {
  return pluginApi[kind]
}
