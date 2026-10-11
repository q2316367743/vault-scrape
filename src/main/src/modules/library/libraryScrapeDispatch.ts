/**
 * 资料库刮削入口：按资料库类型分派到影片 / 剧集两套口径。
 *
 * 影片库的候选是视频文件，剧集库的候选是剧集目录（一次处理整个剧集），
 * 调用方（扫描、资料库 IPC、刮削 IPC）只需要「待刮列表 + 两个启动函数」，
 * 所以库类型判断收口在这里，调用方不必到处 `library.type === 'tv'`。
 */
import type { LibraryTaskResult } from '@common/types/library'
import type { ScrapeScanEntry } from '@common/types/scrape'
import {
  pendingMovieEntries,
  pendingSeriesEntries,
  startLibraryScrape as startMovieLibraryScrape,
  startLibraryScrapeByIds as startMovieLibraryScrapeByIds,
  startSeriesLibraryScrape,
  startSeriesLibraryScrapeByIds
} from './libraryScrape'
import { requireLibrary } from './libraryStore'

function isTvLibrary(libraryId: string): boolean {
  return requireLibrary(libraryId).type === 'tv'
}

/** 待刮削条目：影片库按文件、剧集库按剧集目录（自动刮削判断与扫描进度里的 pending 都用它） */
export function pendingEntries(libraryId: string): ScrapeScanEntry[] {
  return isTvLibrary(libraryId) ? pendingSeriesEntries(libraryId) : pendingMovieEntries(libraryId)
}

/** 刮削整个资料库里还没有元数据的条目 */
export async function startLibraryScrape(libraryId: string): Promise<LibraryTaskResult> {
  return isTvLibrary(libraryId) ? startSeriesLibraryScrape(libraryId) : startMovieLibraryScrape(libraryId)
}

/** 刮削用户勾选的条目 */
export async function startLibraryScrapeByIds(
  libraryId: string,
  itemIds: readonly string[]
): Promise<LibraryTaskResult> {
  return isTvLibrary(libraryId)
    ? startSeriesLibraryScrapeByIds(libraryId, itemIds)
    : startMovieLibraryScrapeByIds(libraryId, itemIds)
}
