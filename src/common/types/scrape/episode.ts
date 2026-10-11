/**
 * 剧集目录名与文件名的解析：季号、集号。
 *
 * 契约：
 * - 纯函数、无 IO，扫描（剧集索引）与刮削（集命名）共用；
 * - **解析不出来就返回 null，绝不猜**——扫描侧会跳过该文件并在结果里报数量；
 * - 认可的集号写法（按优先级）：`S01E02` / `s1e2`、`1x02`、`EP02` / `E02` / `第02集`、
 *   兜底取第一个独立数字（已剔除分辨率与季标记，四位年份不会命中）；
 * - 多集文件（`S01E01E02`、`S01E01-E02`）**按第一集处理**。
 */
import { extractKeyword } from './keyword'

/** 分辨率与编码标记：兜底取数字前先剔除，避免把 1080 当成集号 */
const QUALITY_PATTERN = /\b(?:2160p|1440p|1080p|720p|576p|480p|360p|4k|x264|x265|h264|h265|hevc|avc)\b/gi

/** 季标记（`S02` / `Season 2` / `第2季`）：兜底取数字前先剔除，避免把季号当成集号 */
const SEASON_MARKER_PATTERN = /(?:\b(?:s|season|series)\s*0*\d{1,2}\b|第\s*[0-9一二三四五六七八九十两零]+\s*[季部])/gi

/** 特别篇目录名 */
const SPECIAL_DIR_PATTERN = /^(?:specials?|sp|ova|oad|特别篇|番外篇?|特典)$/i

/** 花絮类目录名：里面的视频不算正片，不入库 */
const EXTRA_DIR_PATTERN =
  /^(?:extras?|featurettes?|behind[\s._-]*the[\s._-]*scenes|deleted[\s._-]*scenes|interviews?|shorts|trailers?|samples?|sample)$/i

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

/**
 * 目录名 → 季号：`Season 01` / `S1` / `第2季` / `第二季` → 2；
 * 特别篇目录（`Specials` / `SP` / `特别篇` / `番外`）→ 0；不是季目录返回 null。
 */
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

/** 该目录名是不是花絮目录（里面的视频不入库） */
export function isExtraVideoDir(dirName: string): boolean {
  return EXTRA_DIR_PATTERN.test(dirName.trim())
}

/** 集号解析结果 */
export interface EpisodeNumber {
  /** 季号；文件名里没有季信息时用调用方给的兜底季号 */
  season: number
  /** 集号（季内序号），从 1 开始 */
  episode: number
}

/**
 * 文件名 → 季号 + 集号。
 *
 * `fallbackSeason` 是文件所在目录给出的季号（没有季目录时为 1），
 * 只有文件名自带季信息（`S01E02` / `1x02`）时才覆盖它。
 */
export function parseEpisodeName(fileName: string, fallbackSeason: number): EpisodeNumber | null {
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
  const matched = /(?:19|20)\d{2}/.exec(dirName)
  return matched ? matched[0] : ''
}
