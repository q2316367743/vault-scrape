/**
 * 候选匹配：从插件搜索结果里挑出与当前文件对应的那一条。
 *
 * 契约：
 * - 纯函数，只做判定不做网络；
 * - 有番号时优先番号对得上（归一化相等或短号是长号后缀）；对不上就回落到标题判定——
 *   很多插件（如 TMDB）根本没有番号概念，硬卡番号会让文件名里带年份/画质的条目永远匹配不上；
 * - 没有可用番号时按标题判定：「只有一个候选」→「候选标题包含关键词」→「关键词包含候选标题（取最长）」；
 * - 剧集没有番号，用 `pickSeriesCandidate`：年份一致优先，之后同样走标题判定；
 * - 匹配不上返回 null，由调用方决定是否换下一个插件。
 */
import type { PluginMovieCandidate } from '@common/types/plugin'
import { extractKeyword, isSameNum, normalizeNum } from '@common/types/scrape'

/** 候选自身的番号：插件字段优先，缺失时从标题里再猜一次 */
function candidateNum(candidate: PluginMovieCandidate): string {
  const declared = (candidate.num ?? '').trim()
  if (declared.length > 0) return declared
  return extractKeyword(candidate.title).num
}

/** 关键词是否出现在候选的标题或番号里（忽略大小写与分隔符） */
function containsKeyword(candidate: PluginMovieCandidate, keyword: string): boolean {
  const needle = normalizeNum(keyword)
  if (needle.length < 3) return false
  const haystack = `${normalizeNum(candidate.title)}${normalizeNum(candidateNum(candidate))}`
  return haystack.includes(needle)
}

/** 反向包含里标题最长的那条：标题越长越能说明「就是它」 */
function pickLongestTitle(
  candidates: readonly PluginMovieCandidate[],
  keyword: string
): PluginMovieCandidate | null {
  const haystack = normalizeNum(keyword)
  let picked: PluginMovieCandidate | null = null
  let pickedLength = 0
  for (const candidate of candidates) {
    const needle = normalizeNum(candidate.title)
    if (needle.length < 3 || !haystack.includes(needle)) continue
    if (needle.length > pickedLength) {
      picked = candidate
      pickedLength = needle.length
    }
  }
  return picked
}

/** 没有可用番号时的标题判定：唯一候选 → 标题包含关键词 → 关键词包含标题（取最长） */
function pickByTitle(
  candidates: readonly PluginMovieCandidate[],
  keyword: string
): PluginMovieCandidate | null {
  if (candidates.length === 1) return candidates[0] ?? null
  const byKeyword = candidates.find((candidate) => containsKeyword(candidate, keyword))
  if (byKeyword) return byKeyword
  return pickLongestTitle(candidates, keyword)
}

export function pickCandidate(
  candidates: readonly PluginMovieCandidate[],
  num: string,
  keyword: string
): PluginMovieCandidate | null {
  if (candidates.length === 0) return null

  const wanted = num.trim()
  if (wanted.length > 0) {
    const same = candidates.find((candidate) => isSameNum(wanted, candidateNum(candidate)))
    if (same) return same
  }

  return pickByTitle(candidates, keyword)
}

/**
 * 剧集候选匹配：剧集没有番号，判定依据只有标题与年份。
 *
 * 顺序：年份一致的候选优先 → 标题判定（唯一候选 / 标题包含关键词 / 关键词包含标题）；
 * 候选之间分不出高低时返回 null，由调用方换下一个插件。
 */
export function pickSeriesCandidate(
  candidates: readonly PluginMovieCandidate[],
  keyword: string,
  year: string
): PluginMovieCandidate | null {
  if (candidates.length === 0) return null
  const wanted = year.trim()
  const byYear =
    wanted.length === 4 ? candidates.filter((candidate) => (candidate.date ?? '').startsWith(wanted)) : []
  const pool = byYear.length > 0 ? byYear : candidates
  return pickByTitle(pool, keyword)
}
