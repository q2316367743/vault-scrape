/**
 * 影视库的目录名 / 文件名规则（纯函数、无 IO）。
 *
 * 口径对齐 Jellyfin / Emby / Plex / Kodi 的目录规范，扫描（电影库与剧集库索引）与剧集刮削共用：
 * - **影片文件夹**：目录名建议 `片名 (年份) [tmdbid-27205]`；视频文件名以目录名为前缀，
 *   前缀之后的部分是「版本标签」（`片名 (2021) - 2160p.mkv` → `2160p`），同目录同前缀的多个文件
 *   是同一部影片的多个版本；前缀对不上的是各自独立的影片条目；
 * - **季目录**：`Season 01` / `S01` / `第1季` / `Specials`（特别篇 → 季 0）；
 * - **剧集文件**：`S01E02` / `1x02` / `EP02` / `第02集`；多集文件（`S01E02E03`、`S01E03-E04`）
 *   **按第一集入库**——`media_source` 上「连接 + 路径」唯一，一个文件挂多集会撞索引；
 * - **花絮**：花絮目录（`extras` / `featurettes` / `trailers`…）与花絮后缀文件
 *   （`-trailer` / `-sample`…）一律不入库，避免被当成正片；
 * - **解析不出来就返回 null，绝不猜**——扫描侧会跳过该文件并在结果里报数量。
 */
import { extractKeyword } from '../scrape/keyword'
import { providerIdsOfTag } from '../scrape/naming'

/** 分辨率与编码标记：兜底取数字前先剔除，避免把 1080 当成集号 */
const QUALITY_PATTERN = /\b(?:2160p|1440p|1080p|720p|576p|480p|360p|4k|x264|x265|h264|h265|hevc|avc)\b/gi

/** 季标记（`S02` / `Season 2` / `第2季`）：兜底取数字前先剔除，避免把季号当成集号 */
const SEASON_MARKER_PATTERN = /(?:\b(?:s|season|series)\s*0*\d{1,2}\b|第\s*[0-9一二三四五六七八九十两零]+\s*[季部])/gi

/** 特别篇目录名 */
const SPECIAL_DIR_PATTERN = /^(?:specials?|sp|ova|oad|特别篇|番外篇?|特典)$/i

/** 花絮类目录名：里面的视频与图片都不入库 */
const EXTRA_DIR_PATTERN =
  /^(?:extras?|featurettes?|behind[\s._-]*the[\s._-]*scenes|deleted[\s._-]*scenes|interviews?|scenes|shorts|clips|trailers?|samples?|sample|other|花絮|预告片?|预告)$/i

/**
 * 花絮类文件后缀。
 *
 * 要求后缀前面有一个 `-` / `.` / `_` 分隔符（空格不算）：`Crime Scene.mkv` 这种片名
 * 结尾带 `scene` 的不会被误判，`Inception (2010) - Trailer.mkv` / `movie-trailer.mkv` 会命中。
 */
const EXTRA_FILE_SEPARATOR = '[\\s._-]*[-._][\\s._-]*'
const EXTRA_FILE_PATTERN = new RegExp(
  `(?:${EXTRA_FILE_SEPARATOR})(?:behind[\\s._-]*the[\\s._-]*scenes|deleted[\\s._-]*scenes?|trailers?|samples?|featurettes?|interviews?|scenes?|shorts?|clips?|other|theme)$`,
  'i'
)

/**
 * 整个文件名就是花絮词（`sample.mkv` / `trailer.mkv`）：没有分隔符可用，单独判一条。
 *
 * 影片目录里的 `sample.mkv` 必须靠这一条才能被排除，否则它会被当成正片入库。
 */
const EXTRA_WHOLE_NAME_PATTERN = /^(?:extras?|samples?|trailers?|featurettes?)$/i

/** 年份：四位，`19xx` / `20xx` */
const YEAR_PATTERN = /(?:19|20)\d{2}/

/** 版本标签与目录名之间的分隔符（前缀之后必须紧跟这些之一） */
const VERSION_SEPARATOR_PATTERN = /^[\s._-]+/

const CHINESE_DIGITS: Readonly<Record<string, number>> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
}

/** 中文数字转阿拉伯数字，只支持到 99（`十` `十一` `二十` `二十三`） */
function chineseToNumber(text: string): number | null {
  if (/^\d+$/.test(text)) return Number(text)
  const ten = text.indexOf('十')
  if (ten < 0) return CHINESE_DIGITS[text] ?? null
  const head = text.slice(0, ten)
  const tail = text.slice(ten + 1)
  const tens = head.length === 0 ? 1 : CHINESE_DIGITS[head]
  const ones = tail.length === 0 ? 0 : CHINESE_DIGITS[tail]
  if (tens === undefined || ones === undefined) return null
  return tens * 10 + ones
}

/** 名称里解析出来的信息：年份与外部 ID 片段（`[tmdbid-27205]`） */
export interface MediaNameInfo {
  /** 4 位年份，没有为空串 */
  year: string
  /** 提供方 → ID；`[tmdbid-27205]` → `{ tmdb: '27205' }`，解析不出来是空对象 */
  providerIds: Record<string, string>
}

/** 目录名 / 文件名（去掉扩展名）→ 年份与外部 ID 片段 */
export function parseMediaName(name: string): MediaNameInfo {
  const providerIds: Record<string, string> = {}
  for (const matched of name.matchAll(/\[([^\]\s]+)\]/g)) {
    Object.assign(providerIds, providerIdsOfTag(matched[1] ?? ''))
  }
  return { year: YEAR_PATTERN.exec(name)?.[0] ?? '', providerIds }
}

/**
 * 视频文件名是不是「目录名的某个版本」。
 *
 * 命中时返回**版本标签**（前缀之后的部分，无后缀即 `''`），不是版本返回 `null`。
 * 两侧都应先去掉扩展名。
 */
export function versionLabelOf(fileBase: string, dirBase: string): string | null {
  const file = fileBase.trim()
  const dir = dirBase.trim()
  if (dir.length === 0) return null
  if (file.length === dir.length) return file.toLowerCase() === dir.toLowerCase() ? '' : null
  if (!file.toLowerCase().startsWith(dir.toLowerCase())) return null
  const rest = file.slice(dir.length)
  if (!VERSION_SEPARATOR_PATTERN.test(rest)) return null
  return rest.replace(VERSION_SEPARATOR_PATTERN, '').trim()
}

/** 视频文件名是不是以目录名为前缀（即同一部影片的一个版本） */
export function isVersionOfFolder(fileBase: string, dirBase: string): boolean {
  return versionLabelOf(fileBase, dirBase) !== null
}

/** 版本排序：无标签（`片名.mkv`）优先，其余按标签自然序 —— 第一个就是主版本 */
export function compareVersionLabel(left: string, right: string): number {
  const leftBare = left.trim().length === 0
  const rightBare = right.trim().length === 0
  if (leftBare !== rightBare) return leftBare ? -1 : 1
  return left.localeCompare(right, undefined, { numeric: true })
}

/** 目录名 → 季号：`Season 01` / `S1` / `第2季` / `第二季` → 2；特别篇目录 → 0；不是季目录返回 null */
export function seasonNumberOfDir(dirName: string): number | null {
  const name = dirName.trim()
  if (name.length === 0) return null
  if (SPECIAL_DIR_PATTERN.test(name)) return 0

  const latin = /^(?:s|season|series)\s*0*(\d{1,3})$/i.exec(name)
  if (latin) return Number(latin[1])

  const chinese = /^第\s*([0-9一二三四五六七八九十两零]+)\s*[季部]$/.exec(name)
  if (chinese) return chineseToNumber(chinese[1] ?? '')

  const numeric = /^(\d{1,2})\s*季$/.exec(name)
  if (numeric) return Number(numeric[1])
  return null
}

/** 该目录名是不是花絮目录（里面的视频与图片都不入库） */
export function isExtraVideoDir(dirName: string): boolean {
  return EXTRA_DIR_PATTERN.test(dirName.trim())
}

/** 该文件名是不是花絮文件（去掉扩展名后判断）；命中时返回命中的后缀片段 */
export function extraKindOfName(fileBase: string): string {
  const name = fileBase.trim()
  if (EXTRA_WHOLE_NAME_PATTERN.test(name)) return name.toLowerCase()
  const matched = EXTRA_FILE_PATTERN.exec(name)
  return matched ? matched[0].replace(/^[\s._-]+/, '').trim().toLowerCase() : ''
}

/** 集号解析结果 */
export interface EpisodeNumber {
  /** 季号；文件名里没有季信息时用调用方给的兜底季号 */
  season: number
  /** 集号（季内序号），从 1 开始 */
  episode: number
}

/**
 * 文件名（含扩展名）→ 季号 + 集号。
 *
 * `fallbackSeason` 是文件所在目录给出的季号（没有季目录时为 1），
 * 只有文件名自带季信息（`S01E02` / `1x02`）时才覆盖它。
 * 多集文件（`S01E02E03` / `S01E03-E04`）按第一集返回。
 */
export function parseEpisodeNumbers(fileName: string, fallbackSeason: number): EpisodeNumber | null {
  const base = fileName.replace(/\.[^.]+$/, '')

  const seasonEpisode = /(?:^|[^0-9a-z])s\s*0*(\d{1,2})[\s._-]*e(?:p)?\s*0*(\d{1,3})/i.exec(base)
  if (seasonEpisode) {
    return { season: Number(seasonEpisode[1]), episode: Number(seasonEpisode[2]) }
  }

  const cross = /(?:^|[^0-9a-z])0*(\d{1,2})\s*x\s*0*(\d{1,3})(?:[^0-9a-z]|$)/i.exec(base)
  if (cross) return { season: Number(cross[1]), episode: Number(cross[2]) }

  const episodeOnly = /(?:^|[^0-9a-z])(?:e(?:p)?|episode)[\s._-]*0*(\d{1,3})(?:[^0-9a-z]|$)/i.exec(base)
  if (episodeOnly) return { season: fallbackSeason, episode: Number(episodeOnly[1]) }

  const chineseEpisode = /第\s*0*(\d{1,3})\s*[集话話期]/.exec(base)
  if (chineseEpisode) return { season: fallbackSeason, episode: Number(chineseEpisode[1]) }

  // 兜底：第一个独立数字。先剔掉分辨率/编码与季标记；数字串限定 1–3 位，
  // 所以四位年份天然不会命中（`2019` 无法被 1–3 位且两侧都是非字母数字的规则匹配）。
  const stripped = base.replace(QUALITY_PATTERN, ' ').replace(SEASON_MARKER_PATTERN, ' ')
  const candidates = stripped.match(/(?:^|[^0-9a-z])(\d{1,3})(?:[^0-9a-z]|$)/gi) ?? []
  for (const candidate of candidates) {
    const digits = candidate.replace(/[^0-9]/g, '')
    const value = digits.length > 0 ? Number(digits) : 0
    if (value <= 0) continue
    return { season: fallbackSeason, episode: value }
  }
  return null
}

/**
 * 剧集目录名 → 搜索关键词。
 *
 * 剧集的关键词来自「多个视频所在子目录的目录名」或剧集名，清洗规则与影片一致；
 * 差别是**去掉结尾的年份**（`Show 2019` → `Show`）：留着年份会让候选标题的
 * 「包含关键词」匹配失败，而年份另有用途（见 `seriesYearOf`）。
 */
export function seriesKeywordOf(dirName: string): string {
  const cleaned = extractKeyword(dirName).cleaned
  return cleaned.replace(/[\s._-]+(?:19|20)\d{2}$/, '').trim()
}

/** 剧集目录名里的年份（`Show (2019)` / `Show 2019` → `2019`），没有返回空串 */
export function seriesYearOf(dirName: string): string {
  const matched = YEAR_PATTERN.exec(dirName)
  return matched ? matched[0] : ''
}
