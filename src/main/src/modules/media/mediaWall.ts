/**
 * 影视墙读模型：把「磁盘上的视频」与「刮削成果」拼成一面墙。
 *
 * 契约：
 * - 列表真相是媒体条目（`media_item.type = 'movie'`）与其媒体源：没刮削过的视频也上墙，
 *   磁盘上删掉的影片会随扫描清理一起消失；
 * - 封面先看条目自己、再退回**父目录条目**，按「主图 → 缩略图 → 背景图 → 剧照 → 其他」
 *   找第一张（扫描期把目录级图片挂在目录条目上、`extrafanart/still*.jpg` 挂在影片上，见 `mediaIndexer`）；
 * - 「是否刮削」= 自己跑过刮削（`scrapedAt > 0`）或磁盘上已经有产出（同目录 NFO / 图片），
 *   与 `countScrapedMovieItems` 同一口径；
 * - 播放地址与封面地址都走 `storage://{连接}/{媒体ID}/{文件名}`，只认 ID 不认路径；
 * - 墙面可以按资料库过滤（`MediaWallRequest.libraryId`，空串 = 全部库）；
 * - 首页三排（最近添加 / 待刮削 / 全部影片）与墙面同一套条目口径，只做排序与截断；
 * - 详情另外读同目录 NFO 作为元信息；读失败不抛错，只当没有。
 */
import { FILE_ROOT, basenameRemotePath, dirnameRemotePath, joinRemotePath } from '@common/types/file'
import type { MediaLibrary } from '@common/types/library'
import {
  MEDIA_COVER_IMAGE_TYPE_ORDER,
  MEDIA_HOME_ROW_LIMIT,
  MediaError,
  buildMediaUrl,
  parseNfoXml,
  type MediaBrowseEntry,
  type MediaDetailRequest,
  type MediaDetailResult,
  type MediaHomeResult,
  type MediaHomeRow,
  type MediaNfoMeta,
  type MediaWallItem,
  type MediaWallRequest,
  type MediaWallResult
} from '@common/types/media'
import type { ScrapeBrowseRequest } from '@common/types/scrape'
import { stripExtension } from '@common/types/scrape'
import type { MediaImageRow } from '$/db/schema/mediaImage'
import type { MediaItemRow } from '$/db/schema/mediaItem'
import type { MediaSourceRow } from '$/db/schema/mediaSource'
import { isSameOrInsidePath } from '$/db/repo/libraryRepo'
import { getImage, listImagesByItem, listImagesByLibrary } from '$/db/repo/mediaImageRepo'
import {
  getItem,
  listChildItems,
  listItems,
  listMovieItems,
  listSourcesByItem,
  maxSourceIndexedAt
} from '$/db/repo/mediaRepo'
import { getFileClient } from '$/modules/file/fileClientManager'
import { folderItemId } from '$/modules/media/mediaIndexer'
import { getLibrary, listLibraries, listSummaries } from '$/modules/library/libraryStore'

/** 主媒体源：路径与条目一致的优先，否则取第一条 */
function primarySourceOf(item: MediaItemRow, sources: readonly MediaSourceRow[]): MediaSourceRow | undefined {
  return sources.find((row) => row.path === item.path) ?? sources[0]
}

/**
 * 条目 ID → 挂在该条目上的全部图片。
 *
 * 一张图只属于一个条目（`media_image` 按「连接 + 路径」唯一），所以这里不用去重。
 */
function imagesByItem(images: readonly MediaImageRow[]): Map<string, MediaImageRow[]> {
  const map = new Map<string, MediaImageRow[]>()
  for (const image of images) {
    const list = map.get(image.itemId)
    if (list) list.push(image)
    else map.set(image.itemId, [image])
  }
  return map
}

/**
 * 封面地址：按 `MEDIA_COVER_IMAGE_TYPE_ORDER`（主图 → 缩略图 → 背景图 → 剧照 → 其他）
 * 逐类找，同一类里先条目自己、再父目录条目，取到第一张就返回；一张都没有返回空串。
 */
function coverUrlOf(item: MediaItemRow, images: Map<string, MediaImageRow[]>): string {
  const owners = item.parentId.length > 0 ? [item.id, item.parentId] : [item.id]
  for (const type of MEDIA_COVER_IMAGE_TYPE_ORDER) {
    for (const ownerId of owners) {
      const image = images.get(ownerId)?.find((row) => row.type === type)
      if (image) return buildMediaUrl(image.connectionId, image.id, basenameRemotePath(image.path))
    }
  }
  return ''
}

/** 条目自己或父目录条目上有没有图片（有图 = 磁盘上已经有刮削产出） */
function hasImageEvidence(item: MediaItemRow, images: Map<string, MediaImageRow[]>): boolean {
  if ((images.get(item.id)?.length ?? 0) > 0) return true
  return item.parentId.length > 0 && (images.get(item.parentId)?.length ?? 0) > 0
}

/**
 * 「是否刮削」：自己跑过刮削（`scrapedAt > 0`），或者磁盘上已经有产出——
 * 同目录 NFO（扫描写在 `hasNfo` 上）或图片（条目 / 父目录条目上的图）。
 *
 * 与 `countScrapedMovieItems` 的口径保持一致；刮削队列（`scrapedAt === 0`）不受影响。
 */
function scrapedOf(item: MediaItemRow, images: Map<string, MediaImageRow[]>): boolean {
  return item.scrapedAt > 0 || item.hasNfo > 0 || hasImageEvidence(item, images)
}

function toWallItem(
  item: MediaItemRow,
  source: MediaSourceRow,
  images: Map<string, MediaImageRow[]>,
  library: MediaLibrary | null
): MediaWallItem {
  const scraped = scrapedOf(item, images)
  return {
    itemId: item.id,
    libraryId: item.libraryId,
    libraryName: library?.name ?? '',
    nsfwProtected: library?.nsfwProtection === true,
    connectionId: source.connectionId,
    path: source.path,
    dirPath: dirnameRemotePath(source.path),
    name: item.name,
    num: item.num,
    title: scraped ? item.name : stripExtension(item.name),
    coverUrl: coverUrlOf(item, images),
    playUrl: buildMediaUrl(source.connectionId, source.id, source.name),
    scraped,
    scrapedAt: item.scrapedAt,
    dateAdded: item.dateAdded,
    pluginId: item.scraperId,
    size: source.size,
    modifiedAt: source.modifiedAt
  }
}

/**
 * 拉取影视墙：默认所有资料库的影片混在一起，筛选与排序都在渲染层做；
 * 给了 `libraryId` 就只返回该库的影片，库不存在直接抛 `notFound`。
 */
export function loadMediaWall(request: MediaWallRequest = { libraryId: '' }): MediaWallResult {
  const libraryId = request.libraryId.trim()
  let libraries: MediaLibrary[]
  if (libraryId.length === 0) {
    libraries = listLibraries()
  } else {
    const library = getLibrary(libraryId)
    if (!library) throw new MediaError('notFound', '资料库不存在')
    libraries = [library]
  }
  const items: MediaWallItem[] = []
  for (const library of libraries) {
    const images = imagesByItem(listImagesByLibrary(library.id))
    for (const item of listMovieItems(library.id)) {
      const source = primarySourceOf(item, listSourcesByItem(item.id))
      if (!source) continue
      items.push(toWallItem(item, source, images, library))
    }
  }
  return {
    items,
    total: items.length,
    scrapedCount: items.filter((item) => item.scraped).length,
    indexedAt: maxSourceIndexedAt(),
    libraries: listSummaries()
  }
}

/** 某个资料库里的影片（与墙面同一套判定与封面规则） */
export function loadLibraryVideos(libraryId: string): MediaWallItem[] {
  const id = libraryId.trim()
  if (id.length === 0) return []
  return loadMediaWall({ libraryId: id }).items
}

/** 排序用的时间：入库时间缺失（0）时退回文件修改时间 */
function timeOf(item: MediaWallItem): number {
  return item.dateAdded > 0 ? item.dateAdded : item.modifiedAt
}

/** 最近添加优先 */
function byTimeDesc(left: MediaWallItem, right: MediaWallItem): number {
  return timeOf(right) - timeOf(left)
}

/**
 * 均匀取样：按步长从整份列表里挑出 `limit` 条，保证「推荐」排不会与
 * 「最近添加」排（同一份列表的前 `limit` 条）完全重复。
 */
function spreadSample(items: MediaWallItem[], limit: number): MediaWallItem[] {
  if (items.length <= limit) return [...items]
  const stride = items.length / limit
  const picked: MediaWallItem[] = []
  for (let index = 0; index < limit; index += 1) {
    const item = items[Math.floor(index * stride)]
    if (item) picked.push(item)
  }
  return picked
}

/**
 * 首页读模型：库摘要 + 三排固定顺序的影片（最近添加 / 待刮削 / 推荐）。
 *
 * 每排取前 `MEDIA_HOME_ROW_LIMIT` 张，统计口径与 `loadMediaWall` 完全一致。
 */
export function loadMediaHome(): MediaHomeResult {
  const wall = loadMediaWall()
  const sorted = [...wall.items].sort(byTimeDesc)
  const rows: MediaHomeRow[] = [
    { id: 'recent', title: '最近添加', items: sorted.slice(0, MEDIA_HOME_ROW_LIMIT) },
    {
      id: 'pending',
      title: '待刮削',
      items: sorted.filter((item) => !item.scraped).slice(0, MEDIA_HOME_ROW_LIMIT)
    },
    { id: 'discover', title: '推荐', items: spreadSample(sorted, MEDIA_HOME_ROW_LIMIT) }
  ]
  return {
    libraries: wall.libraries,
    rows,
    total: wall.total,
    scrapedCount: wall.scrapedCount,
    indexedAt: wall.indexedAt
  }
}

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

function toBrowseEntry(
  row: MediaItemRow,
  withMovies: Map<string, boolean>,
  images: Map<string, MediaImageRow[]>
): MediaBrowseEntry {
  if (row.type === 'folder') {
    return {
      itemId: row.id,
      type: 'folder',
      connectionId: row.connectionId,
      path: row.path,
      name: row.name,
      num: '',
      title: row.name,
      scraped: false,
      hasSource: withMovies.get(row.id) === true,
      size: 0,
      modifiedAt: 0
    }
  }
  const sources = listSourcesByItem(row.id)
  const source = primarySourceOf(row, sources)
  const scraped = scrapedOf(row, images)
  return {
    itemId: row.id,
    type: 'movie',
    connectionId: row.connectionId,
    path: row.path,
    name: row.name,
    num: row.num,
    title: scraped ? row.name : stripExtension(row.name),
    scraped,
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

/**
 * 浏览资料库：`dirPath` 为空表示「资料库各根目录的下一层」。
 *
 * 目录条目由扫描按需创建（连接根 `/` 没有目录条目，直接用 `parentId = ''`）。
 */
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
  const images = imagesByItem(listImagesByLibrary(library.id))
  const seen = new Set<string>()
  const entries: MediaBrowseEntry[] = []
  for (const parentId of parents) {
    for (const row of listChildItems(library.id, parentId)) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      entries.push(toBrowseEntry(row, withMovies, images))
    }
  }
  return entries.sort(compareBrowse)
}

/** 同目录 NFO 候选：`movie.nfo` 优先，其次与视频同名的 `.nfo`（与写入侧的命名规则对应） */
function nfoCandidates(source: MediaSourceRow): string[] {
  return ['movie.nfo', `${stripExtension(source.name)}.nfo`]
}

/** 读同目录 NFO；连接不可用、文件不存在、解析失败都只当作「没有 NFO」 */
async function readNfoMeta(source: MediaSourceRow): Promise<{ meta: MediaNfoMeta | null; path: string }> {
  const dirPath = dirnameRemotePath(source.path)
  for (const name of nfoCandidates(source)) {
    const target = joinRemotePath(dirPath, name)
    try {
      const client = await getFileClient(source.connectionId)
      if (!(await client.exists(target))) continue
      const text = await client.readText(target)
      return { meta: parseNfoXml(text), path: target }
    } catch {
      // 换下一个候选；全都读不到时按没有 NFO 处理
    }
  }
  return { meta: null, path: '' }
}

/** 单个影片的详情：与墙上同一套规则 + 同目录 NFO */
export async function loadMediaDetail(request: MediaDetailRequest): Promise<MediaDetailResult> {
  const itemId = request.itemId.trim()
  if (itemId.length === 0) throw new MediaError('invalidArgument', '缺少影片 ID')
  const item = getItem(itemId)
  if (!item || item.type !== 'movie') throw new MediaError('notFound')
  const source = primarySourceOf(item, listSourcesByItem(item.id))
  if (!source) throw new MediaError('notFound')

  const images = imagesByItem([
    ...listImagesByItem(item.id),
    ...(item.parentId.length > 0 ? listImagesByItem(item.parentId) : [])
  ])
  const library = getLibrary(item.libraryId)
  const nfo = await readNfoMeta(source)
  return {
    item: toWallItem(item, source, images, library ?? null),
    meta: nfo.meta,
    nfoPath: nfo.path
  }
}

/** 供详情 / 调试使用：按 ID 直接取一张图片 */
export { getImage }
