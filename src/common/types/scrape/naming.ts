/**
 * 命名规则渲染：把插件详情按 `SettingNaming` 的模板渲染成文件/文件夹名。
 *
 * 契约：
 * - 纯函数，主进程与渲染层预览共用；
 * - 占位符词表：{num} {title} {actor} {actorFallbackPrefix} {maker} {label} {series}
 *   {date} {year} {month} {day} {studio} {director} {duration} {resolution} {count}
 *   {providerId}；集文件另有 {showTitle} {season} {episode} {episodeTitle}；
 * - 渲染结果先清洗非法字符，再删掉值为空留下的空括号片段（`()` / `[]`），
 *   长度截断由调用方按目标决定（文件夹名与文件名同源同值）。
 */
import type { PluginMovieDetail } from '../plugin'
import type { PartStyle, SettingNaming } from '../setting'

const ILLEGAL_PATTERN = /[\\/:*?"<>|\u0000-\u001f]/g
const SPACE_PATTERN = /\s+/g
const DATE_PATTERN = /(\d{4})\D{0,2}(\d{1,2})\D{0,2}(\d{1,2})/
const EMPTY_GROUP_PATTERN = /\(\s*\)|\[\s*\]|（\s*）|【\s*】/g

/**
 * 外部 ID 片段：Jellyfin 的 `[<provider>id-<value>]` 约定。
 *
 * 插件 ID 去掉尾部 `-offline` 后作为 provider 名（`r18-offline` → `r18id-xxx`）；
 * 缺 ID 时返回空串，模板里的 `[{providerId}]` 会被空片段清理掉。
 */
export function providerTagOf(pluginId: string, id: string): string {
  const value = id.trim()
  const provider = pluginId.trim().replace(/-offline$/i, '')
  if (value.length === 0 || provider.length === 0) return ''
  return `${provider}id-${value}`
}

/** 清洗文件名非法字符，折叠空白与收尾的点 */
export function sanitizeName(value: string): string {
  return value
    .replace(ILLEGAL_PATTERN, ' ')
    .replace(SPACE_PATTERN, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .trim()
}

/** 截断到最大长度（0 或负数表示不限制） */
export function truncateName(value: string, maxLength: number): string {
  if (maxLength <= 0 || value.length <= maxLength) return value
  return value.slice(0, maxLength).trim()
}

/** 演员摘要：按数量截断 + 溢出后缀；演员为空时可按开关回落片商 */
export function actorSummary(detail: PluginMovieDetail, naming: SettingNaming): string {
  const actors = (detail.actors ?? []).map((item) => item.trim()).filter((item) => item.length > 0)
  if (actors.length === 0) return naming.actorFallbackToMaker ? (detail.maker ?? '').trim() : ''
  if (actors.length <= naming.actorMaxCount) return actors.join(' ')
  const kept = actors.slice(0, naming.actorMaxCount)
  const suffix = naming.actorOverflowSuffix.replace('{count}', String(actors.length)).trim()
  return [...kept, suffix].filter((item) => item.length > 0).join(' ')
}

/** 发行日期：解析出年月日后按 `releaseDateFormat` 渲染，解析失败原样返回 */
export function formatReleaseDate(detail: PluginMovieDetail, naming: SettingNaming): string {
  const raw = (detail.releaseDate ?? '').trim()
  if (raw.length === 0) return ''
  const matched = DATE_PATTERN.exec(raw)
  if (!matched) return raw
  const year = matched[1] ?? ''
  const month = (matched[2] ?? '').padStart(2, '0')
  const day = (matched[3] ?? '').padStart(2, '0')
  const values: Record<string, string> = {
    YYYY: year,
    YY: year.slice(-2),
    MM: month,
    DD: day
  }
  const rendered = naming.releaseDateFormat.replace(/YYYY|YY|MM|DD/g, (token) => values[token] ?? token)
  return rendered.trim().length > 0 ? rendered.trim() : raw
}

/** 两位补零的季号/集号（`1` → `01`） */
export function padNumber(value: number): string {
  return String(Math.max(0, Math.trunc(value))).padStart(2, '0')
}

/** 从原文件名里取分辨率标记（`1080p` / `2160p` / `4K`），取不到返回空串 */
export function resolutionOf(fileName: string): string {
  const matched = /(2160p|1440p|1080p|720p|480p|4k)/i.exec(fileName)
  if (!matched) return ''
  const token = matched[1] ?? ''
  return token.toLowerCase() === '4k' ? '4K' : token.toLowerCase()
}

/** 模板值表：影片与剧集目录共用（两边的可用占位符完全一致） */
function templateValues(detail: PluginMovieDetail, naming: SettingNaming): Record<string, string> {
  const date = formatReleaseDate(detail, naming)
  const matched = DATE_PATTERN.exec(detail.releaseDate ?? '')
  const actors = (detail.actors ?? []).map((item) => item.trim()).filter((item) => item.length > 0)
  return {
    num: (detail.num ?? '').trim(),
    title: (detail.title ?? '').trim(),
    actor: actorSummary(detail, naming),
    actorFallbackPrefix: '',
    maker: (detail.maker ?? '').trim(),
    label: (detail.label ?? '').trim(),
    series: (detail.series ?? '').trim(),
    date,
    year: matched?.[1] ?? '',
    month: matched?.[2]?.padStart(2, '0') ?? '',
    day: matched?.[3]?.padStart(2, '0') ?? '',
    studio: (detail.studio ?? '').trim(),
    director: (detail.director ?? '').trim(),
    duration: typeof detail.duration === 'number' && detail.duration > 0 ? String(detail.duration) : '',
    resolution: '',
    count: actors.length > 0 ? String(actors.length) : '',
    providerId: (detail.providerId ?? '').trim()
  }
}

/** 把值表填进模板；未命中的占位符保持原样，最后统一清洗 */
function fillTemplate(template: string, values: Record<string, string>): string {
  const rendered = template.replace(/\{([a-zA-Z]+)\}/g, (token, key: string) => {
    const value = values[key]
    return value === undefined ? token : value
  })
  return sanitizeName(rendered.replace(EMPTY_GROUP_PATTERN, ' '))
}

/** 按模板渲染名称；未命中的占位符保持原样 */
export function renderTemplate(
  template: string,
  detail: PluginMovieDetail,
  naming: SettingNaming
): string {
  return fillTemplate(template, templateValues(detail, naming))
}

/** 集文件模板的额外取值 */
export interface EpisodeTemplateScope {
  /** 剧集名（剧集条目的展示名） */
  showTitle: string
  season: number
  episode: number
  /** 该集标题，可为空 */
  episodeTitle: string
  /** 原本的视频文件名，用来提取 `{resolution}` */
  fileName: string
}

/**
 * 按模板渲染集文件名。
 *
 * `{title}` 仍是剧集名（与影片模板口径一致），集名走 `{episodeTitle}`；
 * `{season}` / `{episode}` 一律两位补零（`S01E01`）。
 */
export function renderEpisodeTemplate(
  template: string,
  detail: PluginMovieDetail,
  naming: SettingNaming,
  scope: EpisodeTemplateScope
): string {
  const values: Record<string, string> = {
    ...templateValues(detail, naming),
    showTitle: scope.showTitle.trim(),
    season: padNumber(scope.season),
    episode: padNumber(scope.episode),
    episodeTitle: scope.episodeTitle.trim(),
    resolution: resolutionOf(scope.fileName)
  }
  return fillTemplate(template, values)
}

/**
 * 按模板渲染季目录名（默认 `Season {season}`）。
 *
 * 只多一个 `{season}`（两位补零），其余占位符与影片模板完全一致。
 */
export function renderSeasonFolderName(
  template: string,
  detail: PluginMovieDetail,
  naming: SettingNaming,
  season: number
): string {
  return fillTemplate(template, { ...templateValues(detail, naming), season: padNumber(season) })
}

/** 占位符词表，供渲染层提示条与文档使用 */
export const NAMING_PLACEHOLDERS: readonly string[] = [
  '{num}',
  '{title}',
  '{actor}',
  '{actorFallbackPrefix}',
  '{maker}',
  '{label}',
  '{series}',
  '{date}',
  '{year}',
  '{month}',
  '{day}',
  '{studio}',
  '{director}',
  '{duration}',
  '{resolution}',
  '{count}',
  '{providerId}'
]

/** 集文件模板额外支持的占位符（影片占位符依然可用） */
export const EPISODE_NAMING_PLACEHOLDERS: readonly string[] = [
  '{showTitle}',
  '{season}',
  '{episode}',
  '{episodeTitle}'
]

/** 季目录模板额外支持的占位符 */
export const SEASON_NAMING_PLACEHOLDERS: readonly string[] = ['{season}']

/**
 * 分盘后缀归一：`origin` 保持原样，其余把名字尾部的 CD/PART/DISC/D 统一成目标样式，
 * 并去掉序号前导零（CD01 → CD1）。
 */
export function resolvePartSuffix(fileName: string, partStyle: PartStyle): string {
  if (partStyle === 'origin') return fileName
  const label = partStyle === 'cd' ? 'CD' : partStyle === 'part' ? 'PART' : 'DISC'
  const pattern = /(^|[\s_\-.])(CD|PART|DISC|D)(\s*0*(\d{1,2}))$/i
  return fileName.replace(pattern, (_token, separator: string, _marker: string, _raw: string, digit: string) =>
    `${separator}${label}${digit}`
  )
}
