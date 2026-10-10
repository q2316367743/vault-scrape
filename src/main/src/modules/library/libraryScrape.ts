/**
 * 资料库刮削：候选条目来自 `media_item`（`scrapedAt === 0` 的影片）。
 *
 * 契约：
 * - 刮削器只取 `library.scrapers`，不再回落连接配置；**空数组 = 该库不刮削**，
 *   手动刮削时直接抛 `pluginMissing`；
 * - 同目录同番号只保留先出现的那条，重复的标记 duplicateOf；
 * - 小于 `library.minFileSizeMb` 的视频不参与刮削（与扫描的体积过滤同一口径）；
 * - 库内没有待刮削文件时抛 `notFound`（中文提示），由 IPC 边界转信封。
 */
import type { LibraryTaskResult, MediaLibrary, MediaLibraryPath } from '@common/types/library'
import { LibraryError, LIBRARY_ERROR_MESSAGES } from '@common/types/library'
import { dirnameRemotePath } from '@common/types/file'
import { ScrapeError, extractKeyword, normalizeNum, type ScrapeScanEntry } from '@common/types/scrape'
import { isSameOrInsidePath } from '$/db/repo/libraryRepo'
import { listPendingMovieItems, listSourcesByItem } from '$/db/repo/mediaRepo'
import { startScrapeTaskForEntries } from '$/modules/scrape/scrapeRunner'
import { requireLibrary } from './libraryStore'

/** 候选条目：比 ScrapeScanEntry 多带连接，用于定位它属于哪个媒体目录 */
export interface LibraryScrapeCandidate extends ScrapeScanEntry {
  connectionId: string
}

/** 一次刮削任务需要的全部信息 */
export interface LibraryScrapePlan {
  library: MediaLibrary
  connectionId: string
  dirPath: string
  entries: ScrapeScanEntry[]
}

function owningPath(library: MediaLibrary, connectionId: string, path: string): MediaLibraryPath | null {
  let best: MediaLibraryPath | null = null
  for (const item of library.paths) {
    if (item.connectionId !== connectionId) continue
    if (!isSameOrInsidePath(item.path, path)) continue
    if (!best || item.path.length > best.path.length) best = item
  }
  return best
}

/** 组装待刮削候选：番号以磁盘文件名解析为准，识别不到时退回条目上的番号 */
function collectCandidates(library: MediaLibrary): LibraryScrapeCandidate[] {
  const minBytes = Math.max(0, library.minFileSizeMb) * 1024 * 1024
  const firstByKey = new Map<string, string>()
  const candidates: LibraryScrapeCandidate[] = []
  for (const item of listPendingMovieItems(library.id)) {
    const sources = listSourcesByItem(item.id)
    const source = sources.find((row) => row.path === item.path) ?? sources[0]
    if (!source) continue
    // 体积过滤与扫描一致：读不到体积（0）时不排除
    if (minBytes > 0 && source.size > 0 && source.size < minBytes) continue
    const parsed = extractKeyword(item.name)
    const num = normalizeNum(parsed.num.length > 0 ? parsed.num : item.num)
    const key = `${dirnameRemotePath(source.path)}\n${num.length > 0 ? num : parsed.cleaned}`
    const duplicateOf = firstByKey.get(key)
    if (duplicateOf === undefined) firstByKey.set(key, item.name)
    const candidate: LibraryScrapeCandidate = {
      itemId: item.id,
      connectionId: source.connectionId,
      path: source.path,
      name: item.name,
      size: source.size,
      modifiedAt: source.modifiedAt,
      keyword: parsed.cleaned,
      num
    }
    if (duplicateOf !== undefined) candidate.duplicateOf = duplicateOf
    candidates.push(candidate)
  }
  return candidates
}

/** 待刮削条目（自动刮削判断与扫描进度里的 pending 都用它） */
export function pendingEntries(libraryId: string): ScrapeScanEntry[] {
  return collectCandidates(requireLibrary(libraryId))
}

/**
 * 规划一次刮削任务。
 *
 * 任务表只支持一个「连接 + 目录」，所以多目录资料库按所属媒体目录分组，
 * 每次只跑条目最多的那一组，其余条目保持 `scrapedAt = 0` 等下次再刮。
 */
export function planLibraryScrape(libraryId: string, itemIds?: readonly string[]): LibraryScrapePlan | null {
  const library = requireLibrary(libraryId)
  const wanted = itemIds === undefined ? null : new Set(itemIds)
  const groups = new Map<string, { connectionId: string; dirPath: string; entries: ScrapeScanEntry[] }>()
  for (const candidate of collectCandidates(library)) {
    if (wanted && !wanted.has(candidate.itemId)) continue
    const owner = owningPath(library, candidate.connectionId, candidate.path)
    if (!owner) continue
    const key = `${candidate.connectionId}\n${owner.path}`
    const group = groups.get(key) ?? { connectionId: candidate.connectionId, dirPath: owner.path, entries: [] }
    group.entries.push({
      itemId: candidate.itemId,
      path: candidate.path,
      name: candidate.name,
      size: candidate.size,
      modifiedAt: candidate.modifiedAt,
      keyword: candidate.keyword,
      num: candidate.num,
      ...(candidate.duplicateOf === undefined ? {} : { duplicateOf: candidate.duplicateOf })
    })
    groups.set(key, group)
  }
  let best: { connectionId: string; dirPath: string; entries: ScrapeScanEntry[] } | null = null
  for (const group of groups.values()) {
    if (!best || group.entries.length > best.entries.length) best = group
  }
  if (!best) return null
  return { library, connectionId: best.connectionId, dirPath: best.dirPath, entries: best.entries }
}

function toLibraryError(error: unknown): LibraryError {
  if (error instanceof LibraryError) return error
  if (error instanceof ScrapeError) {
    if (
      error.code === 'busy' ||
      error.code === 'pluginMissing' ||
      error.code === 'cancelled' ||
      error.code === 'invalidArgument' ||
      error.code === 'notFound'
    ) {
      return new LibraryError(error.code, error.message)
    }
    return new LibraryError('scrapeFailed', error.message)
  }
  const message = error instanceof Error ? error.message : LIBRARY_ERROR_MESSAGES.scrapeFailed
  return new LibraryError('scrapeFailed', message)
}

function runPlan(plan: LibraryScrapePlan): LibraryTaskResult {
  if (plan.library.scrapers.length === 0) {
    throw new LibraryError('pluginMissing', '该资料库未配置刮削器（空刮削器表示不刮削），请先在资料库设置里选择')
  }
  try {
    const task = startScrapeTaskForEntries({
      connectionId: plan.connectionId,
      dirPath: plan.dirPath,
      taskName: `资料库 · ${plan.library.name}`,
      entries: plan.entries,
      scraperIds: plan.library.scrapers,
      libraryId: plan.library.id
    })
    return { taskId: task.id, total: task.total }
  } catch (error) {
    throw toLibraryError(error)
  }
}

/** 刮削整个资料库里还没有元数据的影片 */
export async function startLibraryScrape(libraryId: string): Promise<LibraryTaskResult> {
  const plan = planLibraryScrape(libraryId)
  if (!plan) throw new LibraryError('notFound', '资料库里没有待刮削的影片')
  return runPlan(plan)
}

/** 刮削用户勾选的影片 */
export async function startLibraryScrapeByIds(
  libraryId: string,
  itemIds: readonly string[]
): Promise<LibraryTaskResult> {
  if (itemIds.length === 0) throw new LibraryError('invalidArgument', '请至少选择一个待刮削的影片')
  const plan = planLibraryScrape(libraryId, itemIds)
  if (!plan) throw new LibraryError('notFound', '所选影片已不在待刮削列表中')
  return runPlan(plan)
}
