/**
 * 影片与剧集的公共形状。
 *
 * 契约：字段口径与命名模板占位符对齐（{num} {title} {actor} {maker} {label} {series} {date} {duration}），
 * 后续 NFO 生成与文件命名直接消费这些字段，不再做二次映射。
 */

/** 搜索命中的候选（列表项，字段尽量少） */
export interface PluginMovieCandidate {
  /** 插件内影片 ID，后续 detail / covers / extras 都用它 */
  id: string
  title: string
  /** 番号 */
  num?: string
  /** 预览图地址，仅用于展示，不作为下载项 */
  cover?: string
  /** 发行日期 */
  date?: string
  /** 演员（可选：搜索阶段拿得到就填，拿不到时用 detail 的 actors） */
  actors?: string[]
  isSeries?: boolean
  /** 多集作品的总集数 */
  episodeCount?: number
}

/** 一集 */
export interface PluginEpisode {
  id?: string
  /** 第几集，从 1 开始 */
  index: number
  title?: string
  /** 时长（分钟） */
  duration?: number
  releaseDate?: string
}

/** 影片详情 */
export interface PluginMovieDetail {
  id: string
  title: string
  num?: string
  originalTitle?: string
  plot?: string
  actors?: string[]
  maker?: string
  label?: string
  studio?: string
  series?: string
  director?: string
  releaseDate?: string
  /** 时长（分钟） */
  duration?: number
  tags?: string[]
  /** 多集作品才有 */
  episodes?: PluginEpisode[]
  /**
   * 外部 ID 片段（`r18id-abc00123` 这种）：**由宿主按插件 ID + `id` 填**，插件不需要返回。
   *
   * 命名模板里的 `{providerId}` 与 NFO 的 providerIds 都用它。
   */
  providerId?: string
}
