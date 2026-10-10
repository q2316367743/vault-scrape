import type { MediaBrowseEntry } from '@common/types/media'
import type { ScrapeResult } from '@common/types/scrape'
import type { ScrapeBrowseRequest } from '@common/types/scrape/task'

/** 浏览某个资料库下的目录，返回该层的子目录与影片（工作台手动刮削入口） */
export function browseMedia(request: ScrapeBrowseRequest): Promise<ScrapeResult<MediaBrowseEntry[]>> {
  return window.preload.scrape.browse(request)
}

export const scrapeApi = window.preload.scrape
