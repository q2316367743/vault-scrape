/**
 * 资源下载配置：插件产出的「可下载资源」。
 *
 * 契约：
 * - 插件不直接下载，只返回「链接 + 请求方法 + 请求头」，
 *   防盗链所需的 UA / Referer / Cookie 由插件在 headers 里给出；
 * - `kind` 与下载设置的五个开关一一对应，由宿主决定实际下载哪些内容。
 */

/** 资源用途，对应下载设置里的五个下载开关 */
export type PluginAssetKind = 'thumb' | 'poster' | 'fanart' | 'still' | 'trailer'

export const PLUGIN_ASSET_KINDS: readonly PluginAssetKind[] = [
  'thumb',
  'poster',
  'fanart',
  'still',
  'trailer'
]

/** 封面类资源：由插件的 covers() 返回 */
export const COVER_ASSET_KINDS: readonly PluginAssetKind[] = ['poster', 'thumb', 'fanart']

/** 花絮类资源：由插件的 extras() 返回 */
export const EXTRA_ASSET_KINDS: readonly PluginAssetKind[] = ['still', 'trailer']

export const PLUGIN_ASSET_KIND_LABELS: Readonly<Record<PluginAssetKind, string>> = {
  thumb: '横版缩略图',
  poster: '海报',
  fanart: '背景图',
  still: '剧照',
  trailer: '预告片'
}

export type PluginAssetMethod = 'GET' | 'POST'

export const PLUGIN_ASSET_METHODS: readonly PluginAssetMethod[] = ['GET', 'POST']

/** 资产归属的剧集（多集作品的花絮按集落盘） */
export interface PluginEpisodeRef {
  /** 插件内剧集 ID，可选 */
  id?: string
  /** 第几集，从 1 开始 */
  index: number
  title?: string
}

/** 一条资源下载配置 */
export interface PluginAsset {
  kind: PluginAssetKind
  url: string
  /** 缺省按 GET 处理 */
  method?: PluginAssetMethod
  /** 自定义请求头：UA / Referer / Cookie 等 */
  headers?: Record<string, string>
  /** POST 请求体 */
  body?: string
  /** 同 kind 内的展示名，如「剧照 2」；留空由宿主按序编号 */
  name?: string
  /** 归属剧集，多集作品的花絮才需要 */
  episode?: PluginEpisodeRef
}
