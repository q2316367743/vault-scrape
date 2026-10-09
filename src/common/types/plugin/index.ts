/**
 * 插件模块的公共类型出口。
 *
 * 本目录只放纯类型与纯函数，三端共享；
 * 真正的能力实现位于 main 的 `src/main/src/modules/plugin/`。
 */
export {
  COVER_ASSET_KINDS,
  EXTRA_ASSET_KINDS,
  PLUGIN_ASSET_KINDS,
  PLUGIN_ASSET_KIND_LABELS,
  PLUGIN_ASSET_METHODS,
  type PluginAsset,
  type PluginAssetKind,
  type PluginAssetMethod,
  type PluginEpisodeRef
} from './asset'

export {
  PLUGIN_ID_PATTERN,
  type PluginEnvDraft,
  type PluginEnvField,
  type PluginEnvSnapshot,
  type PluginEnvValue,
  type PluginImportFailure,
  type PluginImportResult,
  type PluginMeta,
  type PluginSource,
  type PluginSummary
} from './manifest'

export {
  isEnvReady,
  normalizeEnvFields,
  normalizeEnvValues,
  readEnvFilledMask,
  PLUGIN_ENV_FIELD_LIMIT
} from './env'

export type { PluginEpisode, PluginMovieCandidate, PluginMovieDetail } from './movie'

export {
  PLUGIN_METHODS,
  type DefinePlugin,
  type PluginContext,
  type PluginHtmlLoader,
  type PluginInvokeData,
  type PluginInvokePayload,
  type PluginMethod,
  type PluginRequestOptions,
  type PluginResponse,
  type ScrapePlugin
} from './define'

export {
  normalizeAsset,
  normalizeAssets,
  normalizeCandidate,
  normalizeCandidates,
  normalizeDetail,
  normalizeMeta,
  PLUGIN_LIST_LIMIT
} from './normalize'

export {
  PLUGIN_ERROR_CODES,
  PLUGIN_ERROR_MESSAGES,
  PluginError,
  describePluginError,
  type PluginErrorCode
} from './error'

export { isPluginOk, pluginFail, pluginOk, type PluginResult } from './result'
