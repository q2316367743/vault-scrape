/**
 * 文件名 → 刮削关键词解析。
 *
 * 契约：
 * - 纯函数，主进程扫描根目录时对每个视频文件调用一次；
 * - 解析失败不抛错：番号识别不到时 `num` 为空串，搜索退回整段清洗后的关键词；
 * - 只是「猜」番号，最终以插件的搜索结果为准。
 */

/** 视为视频的扩展名（小写、不含点） */
export const SCRAPE_VIDEO_EXTENSIONS: readonly string[] = [
  'mp4',
  'mkv',
  'avi',
  'wmv',
  'mov',
  'flv',
  'webm',
  'ts',
  'm2ts',
  'mpg',
  'mpeg',
  'rmvb',
  'rm',
  'asf',
  'iso'
]

/** 识别结果 */
export interface ScrapeKeyword {
  /** 原始文件名（含扩展名） */
  raw: string
  /** 去掉标签与分隔符后的关键词，用于搜索 */
  cleaned: string
  /** 猜出的番号，识别不到时为空串 */
  num: string
}

/** 容易被误判成番号的画质/编码标记 */
const NUM_BLACKLIST: ReadonlySet<string> = new Set([
  'FHD',
  'HD',
  'UHD',
  'SD',
  'XXX',
  'MP4',
  'MKV',
  'AVI',
  'WMV',
  'MOV',
  'FLV',
  'WEBM',
  'TS',
  'M2TS',
  'RMVB',
  'ISO',
  'WEB',
  'WEBRIP',
  'HEVC',
  'H264',
  'H265',
  'X264',
  'X265',
  'AAC',
  'HDR',
  'MPEG',
  'DIVX',
  'XVID',
  'CD',
  'DVD'
])

const BRACKET_PATTERN = /[[【(（][^\]】)）]*[\]】)）]/g
const SEPARATOR_PATTERN = /[_+.,]+/g
const SPACE_PATTERN = /\s+/g
const NUM_PATTERN = /([A-Z]{2,10})[\s_-]?(\d{2,6})/g

/** 去掉扩展名（保留路径分隔符之后的部分调用方自行处理） */
export function stripExtension(fileName: string): string {
  const index = fileName.lastIndexOf('.')
  return index > 0 ? fileName.slice(0, index) : fileName
}

/** 番号归一化：去分隔符、转大写、去掉数字段的前导零，便于比较 */
export function normalizeNum(value: string): string {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const matched = /^([A-Z]+)0*(\d+)$/.exec(compact)
  if (matched && matched[1] && matched[2]) return `${matched[1]}${matched[2]}`
  return compact
}

/** 两个番号是否指向同一部作品：归一化相等，或短的一方是长的一方的后缀（如 259LUXU-1234 与 LUXU-1234） */
export function isSameNum(left: string, right: string): boolean {
  const first = normalizeNum(left)
  const second = normalizeNum(right)
  if (!first || !second) return false
  if (first === second) return true
  const short = first.length <= second.length ? first : second
  const long = first.length <= second.length ? second : first
  return short.length >= 4 && long.endsWith(short)
}

/** 从文本里找第一个不像画质标记的番号 */
function findNum(text: string): string {
  const upper = text.toUpperCase()
  NUM_PATTERN.lastIndex = 0
  let matched = NUM_PATTERN.exec(upper)
  while (matched) {
    const prefix = matched[1] ?? ''
    if (!NUM_BLACKLIST.has(prefix)) return matched[0]
    matched = NUM_PATTERN.exec(upper)
  }
  return ''
}

/**
 * 解析文件名：先去 `[...]`/`【...】` 标签，再归一分隔符，
 * 番号先在有标签清洗后的文本里找，找不到再用原始基础名兜底。
 */
export function extractKeyword(fileName: string): ScrapeKeyword {
  const base = stripExtension(fileName)
  const withoutBrackets = base.replace(BRACKET_PATTERN, ' ')
  const cleaned = withoutBrackets
    .replace(SEPARATOR_PATTERN, ' ')
    .replace(SPACE_PATTERN, ' ')
    .trim()
  const num = findNum(cleaned) || findNum(base)
  return { raw: fileName, cleaned, num }
}

/** 扩展名是否属于视频 */
export function isVideoExt(extname: string): boolean {
  return SCRAPE_VIDEO_EXTENSIONS.includes(extname.toLowerCase())
}
