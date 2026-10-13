/**
 * 影视墙读模型：把「磁盘上的视频」与「刮削成果」拼成一面墙。
 *
 * 契约：
 * - 列表真相是媒体条目：影片库认 `media_item.type = 'movie'`，剧集库认 `type = 'series'`
 *   （整部剧集一张卡，季 / 集是它的下行层级）：没刮削过的也上墙，
 *   磁盘上删掉的影片会随扫描清理一起消失；
 * - 剧集卡上的季数 / 集数 / 体积 / 磁盘时间来自聚合查询（`mediaSeriesRepo.seriesStatsOf`），
 *   播放地址固定为空串（真正能播的是集，用户在详情页里选）；
 * - 封面先看条目自己、再退回**父目录条目**，按「主图 → 缩略图 → 背景图 → 剧照 → 其他」
 *   找第一张（扫描期把目录级图片挂在目录条目上、`extrafanart/still*.jpg` 挂在影片上，见 `mediaIndexer`）；
 * - 影视墙**不按刮削与否分类**（Jellyfin 也没有这种分类）：展示标题只看条目是否
 *   真的跑过刮削（`scrapedAt > 0`，此时 `media_item.name` 已被刮削标题覆盖），
 *   没跑过的用去掉扩展名的文件名；
 * - 播放地址与封面地址都走 `storage://{连接}/{媒体ID}/{文件名}`，只认 ID 不认路径；
 * - 墙面可以按资料库过滤（`MediaWallRequest.libraryId`，空串 = 全部库）；
 * - 首页两排（最近添加 / 推荐）与墙面同一套条目口径，只做排序与截断；
 * - 详情页的元信息直接读库（`media_item` 的刮削列，由刮削与扫描写入），不实时读磁盘 NFO；
 */
import { basenameRemotePath, dirnameRemotePath } from '@common/types/file'
import type { MediaLibrary } from '@common/types/library'
import {
  MEDIA_COVER_IMAGE_TYPE_ORDER,
  MEDIA_HOME_ROW_LIMIT,
  MEDIA_IMAGE_TYPES,
  MediaError,
  buildMediaUrl,
  type MediaDetailImage,
  type MediaDetailMeta,
  type MediaDetailRequest,
  type MediaDetailResult,
  type MediaEpisodeRef,
  type MediaHomeResult,
  type MediaHomeRow,
  type MediaSeasonRef,
  type MediaWallItem,
  type MediaWallRequest,
  type MediaWallResult
} from '@common/types/media'
import { stripExtension } from '@common/types/scrape'
import type { MediaImageRow } from '$/db/schema/mediaImage'
import type { MediaItemRow } from '$/db/schema/mediaItem'
import type { MediaSourceRow } from '$/db/schema/mediaSource'
import { getImage, listImagesByItem, listImagesByLibrary } from '$/db/repo/mediaImageRepo'
import {
  getItem,
  listMovieItems,
  listSourcesByItem,
  listSourcesByLibrary,
  maxSourceIndexedAt,
  readItemMetadata
} from '$/db/repo/mediaRepo'
import {
  EMPTY_SERIES_STATS,
  listEpisodeItems,
  listSeasonItems,
  listSeriesItems,
  seriesStatsOf,
  seriesStatsOfOne,
  type SeriesItemStats
} from '$/db/repo/mediaSeriesRepo'
import { actorRefsOfItem } from '$/modules/actor/actorLink'
import { getTranslation, listTranslations } from '$/db/repo/translationRepo'
import { getLibrary, listLibraries, listSummaries } from '$/modules/library/libraryStore'

/**
 * 主媒体源：优先「路径与条目一致」的那一个（文件型条目），
 * 其次是「文件名与目录名一致」的那个版本（目录型条目，Jellyfin 也这样认主版本），
 * 都对不上才退回第一条（多版本目录里所有版本都带 `- 1080p` 这类后缀时）。
 */
export function primarySourceOf(
  item: MediaItemRow,
  sources: readonly MediaSourceRow[]
): MediaSourceRow | undefined {
  const exact = sources.find((row) => row.path === item.path)
  if (exact) return exact
  const base = stripExtension(basenameRemotePath(item.path)).toLowerCase()
  return sources.find((row) => stripExtension(row.name).toLowerCase() === base) ?? sources[0]
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

/**
 * 详情页的画廊：条目自己的图在前、同目录（父条目）的兜底图在后，
 * 各自按 `MEDIA_IMAGE_TYPES`（主图 → 背景图 → 缩略图 → 剧照 → 徽标 → 横幅 → 其他）排序。
 *
 * 契约：与封面同一套归属规则，同一地址只留一次（目录级图片会被同目录多部影片共用）；
 * 渲染层再按 `type` 决定谁当背景大图、谁上剧照墙。
 */
function detailImagesOf(item: MediaItemRow, images: Map<string, MediaImageRow[]>): MediaDetailImage[] {
  const owners = item.parentId.length > 0 ? [item.id, item.parentId] : [item.id]
  const seen = new Set<string>()
  const result: MediaDetailImage[] = []
  for (const ownerId of owners) {
    const rows = images.get(ownerId) ?? []
    for (const type of MEDIA_IMAGE_TYPES) {
      for (const row of rows) {
        if (row.type !== type) continue
        const url = buildMediaUrl(row.connectionId, row.id, basenameRemotePath(row.path))
        if (seen.has(url)) continue
        seen.add(url)
        result.push({ type: row.type, url })
      }
    }
  }
  return result
}

function toWallItem(
  item: MediaItemRow,
  source: MediaSourceRow,
  images: Map<string, MediaImageRow[]>,
  library: MediaLibrary | null
): MediaWallItem {
  return {
    itemId: item.id,
    type: 'movie',
    libraryId: item.libraryId,
    libraryName: library?.name ?? '',
    nsfwProtected: library?.nsfwProtection === true,
    connectionId: source.connectionId,
    path: source.path,
    dirPath: dirnameRemotePath(source.path),
    name: item.name,
    num: item.num,
    // 目录型条目的名字就是目录名（没有扩展名可去，`Mr. Nobody (2009)` 不能被截成 `Mr`）
    title:
      item.scrapedAt > 0 || source.path !== item.path ? item.name : stripExtension(item.name),
    coverUrl: coverUrlOf(item, images),
    playUrl: buildMediaUrl(source.connectionId, source.id, source.name),
    seasonCount: 0,
    episodeCount: 0,
    dateAdded: item.dateAdded,
    pluginId: item.scraperId,
    size: source.size,
    modifiedAt: source.modifiedAt
  }
}

/**
 * 剧集卡：没有媒体源，季 / 集数与体积 / 时间都来自聚合统计。
 *
 * 与影片卡同一套展示口径：`scrapedAt > 0` 时 `name` 已被刮削标题覆盖，
 * 封面按「剧集条目自己 → 其父目录条目」找（父目录通常是「科幻」这类分类目录，
 * 有目录级海报时能给同目录多部剧集共用）。
 */
function toSeriesWallItem(
  item: MediaItemRow,
  images: Map<string, MediaImageRow[]>,
  library: MediaLibrary | null,
  stats: SeriesItemStats
): MediaWallItem {
  return {
    itemId: item.id,
    type: 'series',
    libraryId: item.libraryId,
    libraryName: library?.name ?? '',
    nsfwProtected: library?.nsfwProtection === true,
    connectionId: item.connectionId,
    path: item.path,
    dirPath: item.path,
    name: item.name,
    num: '',
    title: item.name,
    coverUrl: coverUrlOf(item, images),
    playUrl: '',
    seasonCount: stats.seasonCount,
    episodeCount: stats.episodeCount,
    dateAdded: item.dateAdded,
    pluginId: item.scraperId,
    size: stats.sizeBytes,
    modifiedAt: stats.modifiedAt
  }
}

/**
 * 拉取影视墙：默认所有资料库的条目混在一起，筛选与排序都在渲染层做；
 * 给了 `libraryId` 就只返回该库的条目，库不存在直接抛 `notFound`。
 *
 * 影片库一次取「条目 + 主源」，剧集库一次取「剧集条目 + 全库聚合统计」。
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
    if (library.type === 'tv') {
      const stats = seriesStatsOf(library.id)
      for (const item of listSeriesItems(library.id)) {
        items.push(toSeriesWallItem(item, images, library, stats.get(item.id) ?? EMPTY_SERIES_STATS))
      }
      continue
    }
    for (const item of listMovieItems(library.id)) {
      const source = primarySourceOf(item, listSourcesByItem(item.id))
      if (!source) continue
      items.push(toWallItem(item, source, images, library))
    }
  }
  return {
    items,
    total: items.length,
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

/**
 * 按条目 ID 批量取墙面形状（演员详情页的「出演作品」、手动刮削前的回显用）。
 *
 * 与墙面同一套判定与封面规则：认 `movie` 与 `series` 条目，影片必须有主媒体源，
 * 封面按父目录兜底；查不到的 ID 直接跳过，返回顺序与传入顺序无关。
 */
export function loadWallItems(itemIds: readonly string[]): MediaWallItem[] {
  if (itemIds.length === 0) return []
  const libraries = new Map(listLibraries().map((library) => [library.id, library]))
  const items: MediaWallItem[] = []
  for (const itemId of itemIds) {
    const item = getItem(itemId)
    if (!item) continue
    const images = imagesByItem([
      ...listImagesByItem(item.id),
      ...(item.parentId.length > 0 ? listImagesByItem(item.parentId) : [])
    ])
    const library = libraries.get(item.libraryId) ?? null
    if (item.type === 'series') {
      items.push(toSeriesWallItem(item, images, library, seriesStatsOfOne(item.libraryId, item.id)))
      continue
    }
    if (item.type !== 'movie') continue
    const source = primarySourceOf(item, listSourcesByItem(item.id))
    if (!source) continue
    items.push(toWallItem(item, source, images, library))
  }
  return items
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
 * 首页读模型：库摘要 + 两排固定顺序的影片（最近添加 / 推荐）。
 *
 * 每排取前 `MEDIA_HOME_ROW_LIMIT` 张，统计口径与 `loadMediaWall` 完全一致。
 */
export function loadMediaHome(): MediaHomeResult {
  const wall = loadMediaWall()
  const sorted = [...wall.items].sort(byTimeDesc)
  const rows: MediaHomeRow[] = [
    { id: 'recent', title: '最近添加', items: sorted.slice(0, MEDIA_HOME_ROW_LIMIT) },
    { id: 'discover', title: '推荐', items: spreadSample(sorted, MEDIA_HOME_ROW_LIMIT) }
  ]
  return {
    libraries: wall.libraries,
    rows,
    total: wall.total,
    indexedAt: wall.indexedAt
  }
}

/** 同目录 NFO 的候选名（`movie.nfo` 优先，其次与视频同名的 `.nfo`）；「清除 NFO」共用这套命名 */
export function nfoCandidates(source: MediaSourceRow): string[] {
  // 刮削对目录型条目写的是 `<目录名>.nfo`（多版本时视频名各不相同，只有目录名能对上）
  const dirName = basenameRemotePath(dirnameRemotePath(source.path))
  return ['movie.nfo', `${dirName}.nfo`, `${stripExtension(source.name)}.nfo`]
}

/**
 * 详情元信息：从库里的刮削列组装（详情页不读磁盘 NFO）。
 *
 * 契约：刮削（插件）与扫描（NFO）都把这几列写进库，所以进详情页只有一次 SELECT，
 * 不再产生磁盘 / 网络往返；没刮削过的条目各字段是空值。
 */
function detailMetaOf(item: MediaItemRow): MediaDetailMeta {
  return {
    // 展示名只在真跑过刮削时才算刮削标题（与 `toWallItem` 同一套口径）
    title: item.scrapedAt > 0 ? item.name : '',
    num: item.num,
    originalTitle: item.originalTitle,
    plot: item.overview,
    maker: item.maker,
    label: item.label,
    series: item.series,
    director: item.director,
    releaseDate: item.premiereDate,
    duration: item.runtimeMinutes,
    tags: readItemMetadata(item).tags
  }
}

/**
 * 剧集详情：分季分集 + 剧集级元信息。
 *
 * 契约：
 * - 只有带媒体源的集会进 `seasons`（没有源的残留条目不上详情）；
 * - 图片一次取整库（剧集 / 季 / 集的图都在这份表里），封面按「自己 → 直接父条目」兜底，
 *   所以集没剧照时会退回季海报、季没海报时会退回剧集封面；
 * - 元信息取剧集条目自己的刮削列，与影片同一套口径。
 */
async function loadSeriesDetail(item: MediaItemRow, library: MediaLibrary | null): Promise<MediaDetailResult> {
  const images = imagesByItem(listImagesByLibrary(item.libraryId))
  const sourceByItem = new Map<string, MediaSourceRow[]>()
  for (const source of listSourcesByLibrary(item.libraryId)) {
    const list = sourceByItem.get(source.itemId)
    if (list) list.push(source)
    else sourceByItem.set(source.itemId, [source])
  }
  const seasons: MediaSeasonRef[] = []
  // 一次把剧集 + 全部集的译文取回来（译文表是纯派生数据，一张表一次 IN 查询就够）
  const seasonRows = listSeasonItems(item.libraryId, item.id).map((season) => ({
    season,
    episodes: listEpisodeItems(item.libraryId, season.id)
  }))
  const translations = listTranslations([
    item.id,
    ...seasonRows.flatMap((row) => row.episodes.map((episode) => episode.id))
  ])
  for (const { season, episodes: episodeRows } of seasonRows) {
    const episodes: MediaEpisodeRef[] = []
    for (const episode of episodeRows) {
      const source = primarySourceOf(episode, sourceByItem.get(episode.id) ?? [])
      if (!source) continue
      episodes.push({
        itemId: episode.id,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        // 刮削标题就写在 `name` 上（与影片同一套口径，见 `updateItemMetadata`）
        title: episode.scrapedAt > 0 && episode.name.length > 0 ? episode.name : `第 ${episode.episodeNumber} 集`,
        overview: episode.overview,
        runtimeMinutes: episode.runtimeMinutes,
        premiereDate: episode.premiereDate,
        playUrl: buildMediaUrl(source.connectionId, source.id, source.name),
        coverUrl: coverUrlOf(episode, images),
        path: source.path,
        size: source.size,
        translation: translations.get(episode.id) ?? null
      })
    }
    seasons.push({
      itemId: season.id,
      seasonNumber: season.seasonNumber,
      name: season.name,
      posterUrl: coverUrlOf(season, images),
      episodes
    })
  }
  return {
    item: toSeriesWallItem(item, images, library, seriesStatsOfOne(item.libraryId, item.id)),
    meta: detailMetaOf(item),
    actors: actorRefsOfItem(item.id),
    images: detailImagesOf(item, images),
    seasons,
    translation: translations.get(item.id) ?? null
  }
}

/** 单个条目（影片 / 剧集）的详情：与墙上同一套规则，元信息直接读库 */
export async function loadMediaDetail(request: MediaDetailRequest): Promise<MediaDetailResult> {
  const itemId = request.itemId.trim()
  if (itemId.length === 0) throw new MediaError('invalidArgument', '缺少条目 ID')
  const item = getItem(itemId)
  if (!item) throw new MediaError('notFound')
  const library = getLibrary(item.libraryId) ?? null
  if (item.type === 'series') return loadSeriesDetail(item, library)
  if (item.type !== 'movie') throw new MediaError('notFound')
  const source = primarySourceOf(item, listSourcesByItem(item.id))
  if (!source) throw new MediaError('notFound')

  const images = imagesByItem([
    ...listImagesByItem(item.id),
    ...(item.parentId.length > 0 ? listImagesByItem(item.parentId) : [])
  ])
  return {
    item: toWallItem(item, source, images, library),
    meta: detailMetaOf(item),
    actors: actorRefsOfItem(item.id),
    images: detailImagesOf(item, images),
    seasons: [],
    translation: getTranslation(item.id)
  }
}

/** 供详情 / 调试使用：按 ID 直接取一张图片 */
export { getImage }
