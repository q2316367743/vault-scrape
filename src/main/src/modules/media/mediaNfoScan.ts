import type { FileEntry } from '@common/types/file'
import { basenameRemotePath } from '@common/types/file'
import { mediaSourceKindOf, parseNfoXml } from '@common/types/media'
import type { MediaNfoMeta, NfoKind } from '@common/types/media'
import { isTranslatedNfo, padNumber, stripExtension } from '@common/types/scrape'
import { listItemCastNames } from '$/db/repo/actorRepo'
import { applyScannedMetadata } from '$/db/repo/mediaRepo'
import type { MediaItemScannedMetadataInput } from '$/db/repo/mediaRepo'
import { syncItemCast } from '$/modules/actor/actorLink'
import type { FileClient } from '$/modules/file/FileClient'

/**
 * 扫描期的 NFO 处理：判定「磁盘上有没有 NFO」的证据，并把 NFO 读到的元数据与名单落库。
 *
 * 契约：
 * - 只读 NFO、不写 NFO；元数据写条目、名单写 `media_cast`，之后查询都走数据库（NFO 只是提供方）；
 * - **已经刮削过的条目（`scrapedAt > 0`）一律不读**，重扫不会覆盖刮削结果；
 * - 按根元素校验种类：影片要 `<movie>`、剧集要 `<tvshow>`、季要 `<season>`、集要 `<episodedetails>`，
 *   种类对不上就当没有（`tvshow.nfo` 里的内容不会被当成影片元数据）；
 * - **正文是译文的 NFO**（带 `vaultscrape_translated` 标记）一律不读：译文只该待在译文表里，
 *   把它当成原文写进条目会把原文覆盖掉；
 * - 每层看的文件：影片 `movie.nfo` / `<视频名>.nfo`；剧集 `tvshow.nfo`；
 *   季 `season.nfo` / `seasonNN.nfo`；集 `<集文件名>.nfo`；
 * - 读文件失败静默跳过：条目照常入库，元数据与名单等刮削补齐。
 */

/** 目录里所有 NFO 的基础名（小写）；`movie` 表示目录级 NFO */
export function collectNfoBases(files: readonly FileEntry[]): ReadonlySet<string> {
  const bases = new Set<string>()
  for (const file of files) {
    if (mediaSourceKindOf(file.mime, file.extname) !== 'nfo') continue
    bases.add(stripExtension(file.name).toLowerCase())
  }
  return bases
}

/** 同目录有 `movie.nfo`（目录级）或与视频同名的 `.nfo` 时算「磁盘上已有 NFO 产出」 */
export function hasNfoEvidence(file: FileEntry, nfoBases: ReadonlySet<string>): number {
  if (nfoBases.has('movie')) return 1
  return nfoBases.has(stripExtension(file.name).toLowerCase()) ? 1 : 0
}

/** 目录里基础名（小写、去扩展名）匹配的 NFO 文件，没有返回 null */
function nfoFileNamed(files: readonly FileEntry[], base: string): FileEntry | null {
  return (
    files.find(
      (file) =>
        file.type === 'file' &&
        mediaSourceKindOf(file.mime, file.extname) === 'nfo' &&
        stripExtension(file.name).toLowerCase() === base
    ) ?? null
  )
}

/** 剧集条目的 NFO：目录里的 `tvshow.nfo` */
export function tvShowNfoOf(files: readonly FileEntry[]): FileEntry | null {
  return nfoFileNamed(files, 'tvshow')
}

/** 季条目的 NFO：`season.nfo` 或 `season01.nfo` 这类带季号的写法（Jellyfin / Kodi 都认） */
export function seasonNfoOf(files: readonly FileEntry[], seasonNumber: number): FileEntry | null {
  return (
    nfoFileNamed(files, 'season') ?? nfoFileNamed(files, `season${padNumber(seasonNumber)}`)
  )
}

/** NFO 元数据 → 条目元数据列 */
function scannedMetadataOf(meta: MediaNfoMeta): MediaItemScannedMetadataInput {
  const year = Number.parseInt(meta.year, 10)
  return {
    title: meta.title,
    num: meta.num,
    originalTitle: meta.originalTitle,
    overview: meta.plot,
    premiereDate: meta.releaseDate,
    productionYear: Number.isFinite(year) ? year : 0,
    runtimeMinutes: meta.duration,
    genres: meta.genres,
    studios: meta.studio ? [meta.studio] : meta.maker ? [meta.maker] : meta.label ? [meta.label] : [],
    tags: meta.tags,
    maker: meta.maker,
    label: meta.label,
    series: meta.series,
    director: meta.director,
    providerIds: meta.providerIds
  }
}

/** 扫描期读 NFO 需要的条目信息（窄接口，避免索引器依赖整行） */
export interface NfoImportTarget {
  id: string
  /** 条目路径：目录型影片条目用它取目录名当 NFO 候选（`<目录名>.nfo`） */
  path: string
  /** 0 = 还没被本软件刮削过；非 0 一律不读 NFO */
  scrapedAt: number
}

/** 读一个 NFO 文件并校验根元素种类；读失败 / 解析失败 / 种类不符都返回 null */
async function readNfoOfKind(
  client: FileClient,
  file: FileEntry,
  kind: NfoKind
): Promise<MediaNfoMeta | null> {
  try {
    const xml = await client.readText(file.path)
    // 正文是译文的 NFO 先挡掉：宁可不读，也不把译文当成原文写进条目
    if (isTranslatedNfo(xml)) return null
    const meta = parseNfoXml(xml)
    return meta && meta.kind === kind ? meta : null
  } catch {
    return null
  }
}

/**
 * 把 NFO 读进条目：元数据写条目，名单写 `media_cast`。
 *
 * `candidates` 按优先级给出（前面的先试），只接受根元素为 `kind` 的那一个。
 */
async function importNfo(
  client: FileClient,
  item: NfoImportTarget,
  kind: NfoKind,
  candidates: readonly (FileEntry | null)[]
): Promise<void> {
  if (item.scrapedAt > 0) return
  for (const candidate of candidates) {
    if (!candidate) continue
    const meta = await readNfoOfKind(client, candidate, kind)
    if (!meta) continue
    applyScannedMetadata(item.id, scannedMetadataOf(meta))
    if (meta.actors.length > 0 && listItemCastNames(item.id).length === 0) {
      syncItemCast(item.id, meta.actors)
    }
    return
  }
}

/** 影片条目：读 `movie.nfo`、`<目录名>.nfo`、`<视频名>.nfo`（多个版本时按传入顺序逐个试） */
export async function importMovieNfo(
  client: FileClient,
  item: NfoImportTarget,
  files: readonly FileEntry[],
  videos: readonly FileEntry[]
): Promise<void> {
  const candidates: (FileEntry | null)[] = [nfoFileNamed(files, 'movie')]
  // 目录型条目：NFO 常常以**目录名**命名（Jellyfin / Kodi 都认），多版本时视频名各不相同，只有它能对上
  if (!videos.some((video) => video.path === item.path)) {
    candidates.push(nfoFileNamed(files, basenameRemotePath(item.path).toLowerCase()))
  }
  for (const video of videos) {
    candidates.push(nfoFileNamed(files, stripExtension(video.name).toLowerCase()))
  }
  await importNfo(client, item, 'movie', candidates)
}

/** 剧集条目：读剧集目录里的 `tvshow.nfo` */
export async function importSeriesNfo(
  client: FileClient,
  item: NfoImportTarget,
  files: readonly FileEntry[]
): Promise<void> {
  await importNfo(client, item, 'tvshow', [tvShowNfoOf(files)])
}

/** 季条目：读季目录里的 `season.nfo` / `seasonNN.nfo` */
export async function importSeasonNfo(
  client: FileClient,
  item: NfoImportTarget,
  files: readonly FileEntry[],
  seasonNumber: number
): Promise<void> {
  await importNfo(client, item, 'season', [seasonNfoOf(files, seasonNumber)])
}

/** 集条目：读与集文件同名的 `.nfo`（同一集的多个版本逐个试） */
export async function importEpisodeNfo(
  client: FileClient,
  item: NfoImportTarget,
  files: readonly FileEntry[],
  videos: readonly FileEntry[]
): Promise<void> {
  const candidates = videos.map((video) =>
    nfoFileNamed(files, stripExtension(video.name).toLowerCase())
  )
  await importNfo(client, item, 'episode', candidates)
}
