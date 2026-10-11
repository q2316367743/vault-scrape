/**
 * 资料库目录浏览读模型（刮削时挑目录用，通道 `scrape:browse`）。
 *
 * 契约：
 * - 目录条目由扫描按需创建（连接根 `/` 没有目录条目，直接用 `parentId = ''`）；
 * - `dirPath` 为空或 `/` 表示「资料库各根目录的下一层」；
 * - 只认影片库的 `movie` / `folder` 条目：剧集库的浏览在渲染层没有调用者
 *   （剧集刮削按剧集条目整树走），需要时再按 `series` 补一层。
 */
import { FILE_ROOT } from '@common/types/file'
import type { MediaLibrary } from '@common/types/library'
import { MediaError, type MediaBrowseEntry } from '@common/types/media'
import type { ScrapeBrowseRequest } from '@common/types/scrape'
import { stripExtension } from '@common/types/scrape'
import type { MediaItemRow } from '$/db/schema/mediaItem'
import { isSameOrInsidePath } from '$/db/repo/libraryRepo'
import { listChildItems, listItems, listSourcesByItem } from '$/db/repo/mediaRepo'
import { getLibrary } from '$/modules/library/libraryStore'
import { folderItemId } from '$/modules/media/mediaIndexer'
import { primarySourceOf } from './mediaWall'

/** 目标目录属于哪个媒体目录（同一库内取最长命中） */
function owningPath(library: MediaLibrary, dirPath: string): { connectionId: string; path: string } | null {
  let best: { connectionId: string; path: string } | null = null
  for (const item of library.paths) {
    if (!isSameOrInsidePath(item.path, dirPath)) continue
    if (!best || item.path.length > best.path.length) best = { connectionId: item.connectionId, path: item.path }
  }
  return best
}

/** 目录（含子孙）里有没有影片：一次遍历整库算完，供浏览列表标记空目录 */
function movieSubtree(libraryId: string): Map<string, boolean> {
  const childrenByParent = new Map<string, MediaItemRow[]>()
  for (const row of listItems(libraryId)) {
    const list = childrenByParent.get(row.parentId) ?? []
    list.push(row)
    childrenByParent.set(row.parentId, list)
  }
  const memo = new Map<string, boolean>()
  const walk = (parentId: string): boolean => {
    const cached = memo.get(parentId)
    if (cached !== undefined) return cached
    // 先占位，避免异常数据里的父子环把递归打爆
    memo.set(parentId, false)
    let found = false
    for (const child of childrenByParent.get(parentId) ?? []) {
      if (child.type === 'movie' || walk(child.id)) {
        found = true
        break
      }
    }
    memo.set(parentId, found)
    return found
  }
  for (const row of listItems(libraryId)) {
    if (row.type === 'folder') walk(row.id)
  }
  return memo
}

function toBrowseEntry(row: MediaItemRow, withMovies: Map<string, boolean>): MediaBrowseEntry {
  if (row.type === 'folder') {
    return {
      itemId: row.id,
      type: 'folder',
      connectionId: row.connectionId,
      path: row.path,
      name: row.name,
      num: '',
      title: row.name,
      hasSource: withMovies.get(row.id) === true,
      size: 0,
      modifiedAt: 0
    }
  }
  const sources = listSourcesByItem(row.id)
  const source = primarySourceOf(row, sources)
  return {
    itemId: row.id,
    type: 'movie',
    connectionId: row.connectionId,
    path: row.path,
    name: row.name,
    num: row.num,
    title: row.scrapedAt > 0 ? row.name : stripExtension(row.name),
    hasSource: sources.length > 0,
    size: source?.size ?? 0,
    modifiedAt: source?.modifiedAt ?? 0
  }
}

/** 目录在上、影片在下；同类按名称做自然序排序 */
function compareBrowse(left: MediaBrowseEntry, right: MediaBrowseEntry): number {
  if (left.type !== right.type) return left.type === 'folder' ? -1 : 1
  return left.name.localeCompare(right.name, 'zh-CN', { numeric: true })
}

/** 浏览资料库：`dirPath` 为空表示「资料库各根目录的下一层」 */
export function browseLibrary(request: ScrapeBrowseRequest): MediaBrowseEntry[] {
  const libraryId = request.libraryId.trim()
  if (libraryId.length === 0) throw new MediaError('invalidArgument', '缺少资料库 ID')
  const library = getLibrary(libraryId)
  if (!library) throw new MediaError('notFound')

  const dirPath = request.dirPath.trim()
  const parents: string[] = []
  if (dirPath.length === 0 || dirPath === FILE_ROOT) {
    for (const item of library.paths) {
      parents.push(item.path === FILE_ROOT ? '' : folderItemId(library.id, item.connectionId, item.path))
    }
  } else {
    const owner = owningPath(library, dirPath)
    if (!owner) throw new MediaError('invalidArgument', '目录不在该资料库内')
    parents.push(folderItemId(library.id, owner.connectionId, dirPath))
  }

  const withMovies = movieSubtree(library.id)
  const seen = new Set<string>()
  const entries: MediaBrowseEntry[] = []
  for (const parentId of parents) {
    for (const row of listChildItems(library.id, parentId)) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      entries.push(toBrowseEntry(row, withMovies))
    }
  }
  return entries.sort(compareBrowse)
}
