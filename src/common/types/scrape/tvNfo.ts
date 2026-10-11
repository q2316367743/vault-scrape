/**
 * 剧集 NFO 生成：`tvshow.nfo`（剧集根）、`season.nfo`（季目录）、每集 NFO。
 *
 * 契约与影片 NFO（`./nfo`）一致：
 * - 纯函数，缺失字段直接省略标签，绝不写空标签；
 * - 图片写**相对所在目录**的文件名（剧集根的 `poster.jpg`、季目录的 `poster.jpg`、
 *   集同目录的 `<集名>-thumb.jpg`），读回本地时不需要路径换算；
 * - 「刮削前位置」沿用同一套私有标签（`<originalfilename>` / `<originaldirectory>` /
 *   `<plantedfile>`），清除 NFO 时据此还原；
 * - 只做 XML 转义，不做任何网络/文件操作。
 */
import type { PluginMovieDetail } from '../plugin'
import type { SettingNaming } from '../setting'
import { formatReleaseDate, renderTemplate } from './naming'
import {
  NFO_DECLARATION,
  appendRestore,
  pushNfoActors,
  pushNfoArtTag,
  pushNfoFanart,
  pushNfoTag
} from './nfo'
import type { NfoArtwork, NfoRestoreInfo } from './nfo'

/** 集 NFO 的写入范围（由刮削任务从条目 + 插件详情组装） */
export interface EpisodeNfoScope {
  /** 季号；`0` 表示特别篇 */
  season: number
  /** 季内集号 */
  episode: number
  /** 该集标题 */
  title: string
  /** 该集简介，缺省回落剧集简介 */
  plot?: string
  /** 播出日期（插件原始格式，按 `naming.releaseDateFormat` 渲染） */
  releaseDate?: string
  /** 时长（分钟） */
  runtime?: number
  /** 剧照相对路径（`<集名>-thumb.jpg`） */
  still?: string
}

/** 剧集根 NFO：`<tvshow>` */
export function buildTvShowNfoXml(
  detail: PluginMovieDetail,
  naming: SettingNaming,
  artwork: NfoArtwork = {},
  restore: NfoRestoreInfo | null = null
): string {
  const rows: string[] = []
  const title = renderTemplate(naming.nfoTitleTemplate, detail, naming) || (detail.title ?? '').trim()
  pushNfoTag(rows, 'title', title)
  pushNfoTag(rows, 'originaltitle', detail.originalTitle)
  pushNfoTag(rows, 'plot', detail.plot)

  pushNfoArtTag(rows, 'thumb', artwork.poster, 'poster')
  pushNfoArtTag(rows, 'banner', artwork.banner)
  pushNfoArtTag(rows, 'logo', artwork.logo)
  pushNfoFanart(rows, [artwork.backdrop, ...(artwork.stills ?? [])])

  pushNfoActors(rows, detail.actors)
  for (const genre of detail.genres ?? []) pushNfoTag(rows, 'genre', genre)
  pushNfoTag(rows, 'studio', detail.studio)

  const date = formatReleaseDate(detail, naming)
  pushNfoTag(rows, 'premiered', date)
  pushNfoTag(rows, 'year', /^(\d{4})/.exec(date)?.[1] ?? '')
  for (const tag of detail.tags ?? []) pushNfoTag(rows, 'tag', tag)

  if (restore) appendRestore(rows, restore)
  return `${NFO_DECLARATION}\n<tvshow>\n${rows.join('\n')}\n</tvshow>\n`
}

/** 季目录 NFO：`<season>`（季级元数据只有季号、标题与图片） */
export function buildSeasonNfoXml(
  seasonNumber: number,
  title: string,
  artwork: NfoArtwork = {},
  restore: NfoRestoreInfo | null = null
): string {
  const rows: string[] = []
  pushNfoTag(rows, 'seasonnumber', String(seasonNumber))
  pushNfoTag(rows, 'title', title)
  pushNfoArtTag(rows, 'thumb', artwork.poster, 'poster')
  pushNfoFanart(rows, [artwork.backdrop])
  if (restore) appendRestore(rows, restore)
  return `${NFO_DECLARATION}\n<season>\n${rows.join('\n')}\n</season>\n`
}

/** 单集 NFO：`<episodedetails>` */
export function buildEpisodeNfoXml(
  detail: PluginMovieDetail,
  naming: SettingNaming,
  scope: EpisodeNfoScope,
  restore: NfoRestoreInfo | null = null
): string {
  const rows: string[] = []
  pushNfoTag(rows, 'title', scope.title)
  pushNfoTag(rows, 'showtitle', detail.title)
  pushNfoTag(rows, 'season', String(scope.season))
  pushNfoTag(rows, 'episode', String(scope.episode))
  pushNfoTag(rows, 'plot', scope.plot ?? detail.plot)
  pushNfoTag(
    rows,
    'aired',
    formatReleaseDate({ id: detail.id, title: detail.title, releaseDate: scope.releaseDate }, naming)
  )
  if (typeof scope.runtime === 'number' && scope.runtime > 0) {
    pushNfoTag(rows, 'runtime', String(scope.runtime))
  }
  pushNfoArtTag(rows, 'thumb', scope.still)
  pushNfoActors(rows, detail.actors)
  for (const tag of detail.tags ?? []) pushNfoTag(rows, 'tag', tag)

  if (restore) appendRestore(rows, restore)
  return `${NFO_DECLARATION}\n<episodedetails>\n${rows.join('\n')}\n</episodedetails>\n`
}
