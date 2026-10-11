/**
 * 候选匹配：从插件搜索结果里挑出与当前文件对应的那一条。
 *
 * 契约：
 * - 纯函数，只做判定不做网络；
 * - 有番号时必须番号对得上（归一化相等或短号是长号后缀），**绝不猜**；
 * - 没有番号时优先「只有一个候选」，其次标题包含关键词；
 * - 剧集没有番号，用 `pickSeriesCandidate`：年份一致优先，其次标题包含关键词，分不出高低就返回 null；
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

export function pickCandidate(
  candidates: readonly PluginMovieCandidate[],
  num: string,
  keyword: string
): PluginMovieCandidate | null {
  if (candidates.length === 0) return null

  const wanted = num.trim()
  if (wanted.length > 0) {
    const same = candidates.find((candidate) => isSameNum(wanted, candidateNum(candidate)))
    return same ?? null
  }

  if (candidates.length === 1) return candidates[0] ?? null
  const byKeyword = candidates.find((candidate) => containsKeyword(candidate, keyword))
  return byKeyword ?? null
}

/**
 * 剧集候选匹配：剧集没有番号，判定依据只有标题与年份。
 *
 * 顺序：年份一致的候选优先 → 标题包含关键词 → 唯一的候选；
 * 候选之间分不出高低时返回 null（**绝不猜**），由调用方换下一个插件。
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
  if (pool.length === 1) return pool[0] ?? null
  return pool.find((candidate) => containsKeyword(candidate, keyword)) ?? null
}
