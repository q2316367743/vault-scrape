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
  /** 第几季，从 1 开始；`0` 表示特别篇，缺省按第 1 季 */
  season?: number
  /** 第几集（季内序号），从 1 开始 */
  index: number
  title?: string
  /** 分集简介（剧集 NFO 的 `<plot>` 与详情页简介用它） */
  plot?: string
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
  /** 题材（剧集 NFO 的 `<genre>` 用它；影片 NFO 目前只写 tags） */
  genres?: string[]
  /** 多集作品才有（剧集即「多季多集」） */
  episodes?: PluginEpisode[]
  /**
   * 外部 ID 片段（`r18id-abc00123` 这种）：**由宿主按插件 ID + `id` 填**，插件不需要返回。
   *
   * 命名模板里的 `{providerId}` 与 NFO 的 providerIds 都用它。
   */
  providerId?: string
}
