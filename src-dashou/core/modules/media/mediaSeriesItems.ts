/**
 * 剧集树的条目层：`series → season → episode` 的 ID 规则、身份认领与写入。
 *
 * 契约：
 * - 条目身份按「路径 → 组内视频的媒体源 → 视频路径」逐级认（`./mediaScanCommon` 的 `findOwnedItem`），
 *   且**只认同类型条目**：同一个目录从「剧集」变成「季」时不复用旧行；
 * - 剧集目录里直接放视频时，多个隐式季共用剧集目录这一条路径，季身份必须**同时看路径与季号**；
 * - **同季同集号的多个文件是同一集的多个版本**：合成一个 `episode` 条目 + 多条 `media_source`
 *   （文件名自然序第一的当主版本，条目路径跟着它走）；
 * - 已刮削（`scrapedAt > 0`）的条目只修父子关系、路径、季集号与 NFO 证据，标题保持刮削结果；
 * - 刮削改名后就地改写路径、id 不变，重扫既不会造重复、也不会丢掉已写好的元数据。
 *
 * 目录遍历与图片归属在 `./mediaSeriesIndexer`。
 */
import type { MediaLibrary } from '@common/types/library'
import { basenameRemotePath, guessMimeType, type FileEntry } from '@common/types/file'
import { findItemByPath, getItem, insertItem, updateItem, upsertSource } from '$/db/repo/mediaRepo'
import type { MediaItemScanPatch, MediaItemType } from '$/db/repo/mediaRepo'
import { hasNfoEvidence } from './mediaNfoScan'
import { findOwnedItem, hashId, mediaSourceId } from './mediaScanCommon'

/** 剧集条目 ID：`sha1('series\n' + libraryId + '\n' + connectionId + '\n' + 剧集目录路径)` */
export function seriesItemId(libraryId: string, connectionId: string, dirPath: string): string {
  return hashId(`series\n${libraryId}\n${connectionId}\n${dirPath}`)
}

/**
 * 季条目 ID：`sha1('season\n' + libraryId + '\n' + connectionId + '\n' + 季目录路径 + '\n' + 季号)`。
 *
 * 带季号是因为「剧集目录里直接放视频」时，多个隐式季共用剧集目录这一个路径，只靠路径会撞 ID。
 */
export function seasonItemId(
  libraryId: string,
  connectionId: string,
  dirPath: string,
  seasonNumber: number
): string {
  return hashId(`season\n${libraryId}\n${connectionId}\n${dirPath}\n${seasonNumber}`)
}

/** 集条目 ID：`sha1('episode\n' + connectionId + '\n' + 视频路径)` */
export function episodeItemId(connectionId: string, path: string): string {
  return hashId(`episode\n${connectionId}\n${path}`)
}

/**
 * 认领同类型条目：先按「连接 + 路径」找，再按确定性 ID 找，都没有就当新条目。
 *
 * 同一路径上可能存在不同类型的条目（例如剧集目录与它的隐式季共用路径），因此必须比对 `type`。
 */
function resolveItemId(
  connectionId: string,
  path: string,
  type: MediaItemType,
  candidateId: string
): { id: string; exists: boolean } {
  const byPath = findItemByPath(connectionId, path)
  if (byPath && byPath.type === type) return { id: byPath.id, exists: true }
  const byId = getItem(candidateId)
  if (byId && byId.type === type) return { id: candidateId, exists: true }
  return { id: candidateId, exists: false }
}

/** 目录在剧集树里的角色：剧集目录，或某个剧集的某一季 */
export interface DirContext {
  kind: 'series' | 'season'
  /** 该目录对应的条目 ID（剧集目录 → 剧集条目；季目录 → 季条目） */
  itemId: string
  /** 条目所在的目录路径（隐式季就落在剧集目录上；更深一层目录沿用祖先的路径） */
  itemPath: string
  seriesId: string
  /** 季号；剧集目录为 0 */
  season: number
  /** 季号是否由目录名写明（写明时以目录为准，否则用文件名里的季号） */
  namedSeason: boolean
}

/** 建好 / 更新剧集条目，返回条目 ID */
export function ensureSeriesItem(
  library: MediaLibrary,
  connectionId: string,
  dirPath: string,
  nfoBases: ReadonlySet<string>
): string {
  const { id, exists } = resolveItemId(
    connectionId,
    dirPath,
    'series',
    seriesItemId(library.id, connectionId, dirPath)
  )
  const hasNfo = nfoBases.has('tvshow') ? 1 : 0
  if (exists) {
    // 重扫只修父子关系与 NFO 证据，名字交给刮削结果
    updateItem(id, { parentId: '', hasNfo })
  } else {
    insertItem({
      id,
      libraryId: library.id,
      connectionId,
      type: 'series',
      parentId: '',
      path: dirPath,
      name: basenameRemotePath(dirPath),
      hasNfo
    })
  }
  return id
}

/**
 * 建好 / 更新季条目，返回条目 ID 与它当前的刮削时间。
 *
 * 认身份必须**同时看路径与季号**：剧集目录里直接放视频时，多个隐式季共用剧集目录这一条路径，
 * 只按路径认会把第 2 季并进第 1 季。
 */
export function ensureSeasonItem(
  library: MediaLibrary,
  connectionId: string,
  seriesId: string,
  dirPath: string,
  seasonNumber: number,
  name: string,
  nfoBases: ReadonlySet<string>
): { itemId: string; scrapedAt: number } {
  const byPath = findItemByPath(connectionId, dirPath)
  const byId = getItem(seasonItemId(library.id, connectionId, dirPath, seasonNumber))
  const existing =
    byPath?.type === 'season' && byPath.seasonNumber === seasonNumber
      ? byPath
      : byId?.type === 'season'
        ? byId
        : null
  const hasNfo = nfoBases.has('season') ? 1 : 0
  if (existing) {
    updateItem(existing.id, { parentId: seriesId, seasonNumber, hasNfo })
    return { itemId: existing.id, scrapedAt: existing.scrapedAt }
  }
  const itemId = seasonItemId(library.id, connectionId, dirPath, seasonNumber)
  insertItem({
    id: itemId,
    libraryId: library.id,
    connectionId,
    type: 'season',
    parentId: seriesId,
    path: dirPath,
    name,
    seasonNumber,
    hasNfo
  })
  return { itemId, scrapedAt: 0 }
}

/** 同一集的所有版本 */
export interface EpisodeGroup {
  season: number
  episode: number
  videos: FileEntry[]
}

/**
 * 写入一集（含它的多个版本），返回条目 ID 与它当前的刮削时间。
 *
 * 身份按「主版本文件路径 → 组内任一视频的媒体源 → 视频路径」认：主版本换了（新增 / 删掉版本文件）
 * 条目路径会跟着变，但媒体源仍指着同一条目，id 与已刮好的元数据都不会丢；主版本取文件名自然序第一个。
 * 已刮削过的条目只修父子关系、路径、季集号与 NFO 证据，标题保持刮削结果。
 */
export function indexEpisode(
  library: MediaLibrary,
  connectionId: string,
  scanId: string,
  parentId: string,
  group: EpisodeGroup,
  nfoBases: ReadonlySet<string>
): { itemId: string; primaryPath: string; scrapedAt: number } {
  const videos = [...group.videos].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { numeric: true })
  )
  const primary = videos[0]
  const found = findOwnedItem(
    connectionId,
    primary.path,
    videos.map((video) => video.path),
    'episode'
  )
  const itemId = found?.id ?? episodeItemId(connectionId, primary.path)
  const hasNfo = videos.some((video) => hasNfoEvidence(video, nfoBases) === 1) ? 1 : 0
  if (found) {
    const patch: MediaItemScanPatch = {
      parentId,
      path: primary.path,
      seasonNumber: group.season,
      episodeNumber: group.episode,
      hasNfo
    }
    if (found.scrapedAt === 0) patch.name = primary.name
    updateItem(itemId, patch)
  } else {
    insertItem({
      id: itemId,
      libraryId: library.id,
      connectionId,
      type: 'episode',
      parentId,
      path: primary.path,
      name: primary.name,
      seasonNumber: group.season,
      episodeNumber: group.episode,
      hasNfo
    })
  }
  for (const video of videos) {
    // 源一律走 upsertSource：它按 (connectionId, path) 认领，重新分组时会把源改挂到新条目
    upsertSource(
      {
        id: mediaSourceId(connectionId, video.path),
        itemId,
        libraryId: library.id,
        connectionId,
        path: video.path,
        name: video.name,
        extname: video.extname,
        mime: video.mime || guessMimeType(video.name),
        size: video.size,
        modifiedAt: video.modifiedAt
      },
      scanId
    )
  }
  return { itemId, primaryPath: primary.path, scrapedAt: found?.scrapedAt ?? 0 }
}

