/**
 * 剧集链路的仓储查询（剧集 → 季 → 集）。
 *
 * 表结构与影视库完全共用（media_item / media_source / media_image），
 * 区别只在条目类型：剧集库用 `series` / `season` / `episode`，
 * **只有 `episode` 挂媒体源**，剧集与季靠 `path` + `parent_id` 串层级。
 *
 * 独立成文件的原因：`mediaRepo.ts` 已近 500 行上限，且剧集专属查询集中一处更好维护。
 *
 * 路径改写约定：剧集目录被改名/移动后，条目 `id` **保持原值不变**（与影片移动后
 * `refreshSourcePath` 只改 `path` 的口径一致），只改写 `path`。因此 `parent_id`
 * 不需要跟着重算，扫描侧认身份时必须走 `findItemByPath`，不能拿新路径重算哈希再查。
 */
import { and, asc, eq, or, sql } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { db } from '../client'
import { mediaImageTable, mediaItemTable, mediaSourceTable } from '../schema'
import type { MediaItemRow, MediaSourceRow } from '../schema'
import { listItems, listSourcesByItem, listSourcesByLibrary } from './mediaRepo'

/** 单个剧集的聚合统计（影视墙卡片与刮削候选共用） */
export interface SeriesItemStats {
  /** 季数（含特别篇） */
  seasonCount: number
  /** 总集数 */
  episodeCount: number
  /** 全部集的媒体源体积之和 */
  sizeBytes: number
  /** 最大单集体积；刮削的最小体积过滤与任务行展示用它 */
  maxEpisodeBytes: number
  /** 最近一次集文件的修改时间 */
  modifiedAt: number
}

export const EMPTY_SERIES_STATS: SeriesItemStats = {
  seasonCount: 0,
  episodeCount: 0,
  sizeBytes: 0,
  maxEpisodeBytes: 0,
  modifiedAt: 0
}

function itemsOfType(libraryId: string, type: MediaItemRow['type']): MediaItemRow[] {
  return db()
    .select()
    .from(mediaItemTable)
    .where(and(eq(mediaItemTable.libraryId, libraryId), eq(mediaItemTable.type, type)))
    .orderBy(asc(mediaItemTable.name), asc(mediaItemTable.id))
    .all()
}

/** 库里的剧集条目；`libraryId` 省略时返回全部库 */
export function listSeriesItems(libraryId?: string): MediaItemRow[] {
  const typeFilter = eq(mediaItemTable.type, 'series')
  return db()
    .select()
    .from(mediaItemTable)
    .where(libraryId ? and(typeFilter, eq(mediaItemTable.libraryId, libraryId)) : typeFilter)
    .orderBy(asc(mediaItemTable.name), asc(mediaItemTable.id))
    .all()
}

/** 库里还没刮削过的剧集（`scraped_at = 0` 且路径非空） */
export function listPendingSeriesItems(libraryId: string): MediaItemRow[] {
  return listSeriesItems(libraryId).filter((row) => row.scrapedAt === 0 && row.path.length > 0)
}

export function countSeriesItems(libraryId: string): number {
  const row = db()
    .select({ value: sql<number>`count(*)` })
    .from(mediaItemTable)
    .where(and(eq(mediaItemTable.libraryId, libraryId), eq(mediaItemTable.type, 'series')))
    .get()
  return row?.value ?? 0
}

/** 剧集下的季，按季号升序（特别篇 season 0 排最前） */
export function listSeasonItems(libraryId: string, seriesId: string): MediaItemRow[] {
  return db()
    .select()
    .from(mediaItemTable)
    .where(
      and(
        eq(mediaItemTable.libraryId, libraryId),
        eq(mediaItemTable.parentId, seriesId),
        eq(mediaItemTable.type, 'season')
      )
    )
    .orderBy(asc(mediaItemTable.seasonNumber), asc(mediaItemTable.name))
    .all()
}

/** 季下的集，按集号升序（按名字排序对 E2/E10 不可靠，所以用集号列） */
export function listEpisodeItems(libraryId: string, seasonId: string): MediaItemRow[] {
  return db()
    .select()
    .from(mediaItemTable)
    .where(
      and(
        eq(mediaItemTable.libraryId, libraryId),
        eq(mediaItemTable.parentId, seasonId),
        eq(mediaItemTable.type, 'episode')
      )
    )
    .orderBy(asc(mediaItemTable.episodeNumber), asc(mediaItemTable.name))
    .all()
}

/**
 * 一次算完库里所有剧集的聚合统计。
 *
 * 走「全量取季 / 集 / 源 + 内存聚合」而不是 SQL 分组联接：数据量是单库规模，
 * 少一次组装的复杂度与别名风险，读起来也直白。
 */
export function seriesStatsOf(libraryId: string): Map<string, SeriesItemStats> {
  const result = new Map<string, SeriesItemStats>()
  const seriesRows = listSeriesItems(libraryId)
  if (seriesRows.length === 0) return result
  for (const row of seriesRows) result.set(row.id, { ...EMPTY_SERIES_STATS })

  const seasonRows = itemsOfType(libraryId, 'season')
  const episodeRows = itemsOfType(libraryId, 'episode')
  const sourceByItem = new Map<string, MediaSourceRow>()
  for (const source of listSourcesByLibrary(libraryId)) {
    if (!sourceByItem.has(source.itemId)) sourceByItem.set(source.itemId, source)
  }

  const seriesOfSeason = new Map<string, string>()
  for (const season of seasonRows) {
    seriesOfSeason.set(season.id, season.parentId)
    const stats = result.get(season.parentId)
    if (stats) stats.seasonCount += 1
  }

  for (const episode of episodeRows) {
    // 正常情况集挂在季下；兜底兼容「没有季目录时直接挂在剧集下」的隐式结构
    const seriesId = seriesOfSeason.get(episode.parentId) ?? episode.parentId
    const stats = result.get(seriesId)
    if (!stats) continue
    stats.episodeCount += 1
    const source = sourceByItem.get(episode.id)
    if (!source) continue
    stats.sizeBytes += source.size
    stats.maxEpisodeBytes = Math.max(stats.maxEpisodeBytes, source.size)
    stats.modifiedAt = Math.max(stats.modifiedAt, source.modifiedAt)
  }
  return result
}

/** 单个剧集的统计；没有季/集时返回零值 */
export function seriesStatsOfOne(libraryId: string, seriesId: string): SeriesItemStats {
  return seriesStatsOf(libraryId).get(seriesId) ?? { ...EMPTY_SERIES_STATS }
}

/**
 * 命中「路径等于该前缀，或位于该前缀之下」的条件。
 *
 * 用 `substr` 比较而不是 LIKE：路径里带 `_` 时 LIKE 会把它当通配符。
 */
function pathAtOrUnder(column: AnySQLiteColumn, prefix: string) {
  return or(eq(column, prefix), sql`substr(${column}, 1, ${prefix.length + 1}) = ${`${prefix}/`}`)
}

/**
 * 把库内所有以 `fromPrefix` 为根的路径改写成 `toPrefix` 开头。
 *
 * 覆盖条目路径、媒体源路径与图片路径（剧集目录整树改名后调用一次）。
 * 条目 `id` 与 `parent_id` 一律不动，只改 `path`（见文件头约定）。
 */
export function replacePathPrefix(libraryId: string, fromPrefix: string, toPrefix: string): number {
  if (fromPrefix.length === 0 || fromPrefix === toPrefix) return 0
  const now = Date.now()
  let changed = 0

  const rewrite = (path: string): string => toPrefix + path.slice(fromPrefix.length)

  const itemRows = db()
    .select({ id: mediaItemTable.id, path: mediaItemTable.path })
    .from(mediaItemTable)
    .where(and(eq(mediaItemTable.libraryId, libraryId), pathAtOrUnder(mediaItemTable.path, fromPrefix)))
    .all()
  for (const row of itemRows) {
    db()
      .update(mediaItemTable)
      .set({ path: rewrite(row.path), updatedAt: now })
      .where(eq(mediaItemTable.id, row.id))
      .run()
    changed += 1
  }

  const sourceRows = db()
    .select({ id: mediaSourceTable.id, path: mediaSourceTable.path })
    .from(mediaSourceTable)
    .where(and(eq(mediaSourceTable.libraryId, libraryId), pathAtOrUnder(mediaSourceTable.path, fromPrefix)))
    .all()
  for (const row of sourceRows) {
    db().update(mediaSourceTable).set({ path: rewrite(row.path) }).where(eq(mediaSourceTable.id, row.id)).run()
    changed += 1
  }

  const imageRows = db()
    .select({ id: mediaImageTable.id, path: mediaImageTable.path })
    .from(mediaImageTable)
    .where(and(eq(mediaImageTable.libraryId, libraryId), pathAtOrUnder(mediaImageTable.path, fromPrefix)))
    .all()
  for (const row of imageRows) {
    db().update(mediaImageTable).set({ path: rewrite(row.path) }).where(eq(mediaImageTable.id, row.id)).run()
    changed += 1
  }

  return changed
}

/** 剧集下的一集（带它当前的媒体源路径），刮削任务按这份清单改名 / 移动文件 */
export interface SeriesEpisodeFile {
  itemId: string
  /** 所属季条目 ID；「集直接挂在剧集下」的隐式结构里为空串 */
  seasonItemId: string
  seasonNumber: number
  /** 集号，从 1 开始 */
  episodeNumber: number
  /** 条目名（扫描时记下的文件名） */
  name: string
  /** 当前视频路径：优先取媒体源，缺失时回落条目路径 */
  path: string
  size: number
}

/**
 * 一个剧集下的全部集，按「季号 → 集号」升序。
 *
 * 兼容两种结构：正常的 `series → season → episode`，以及没有季目录时
 * 「集直接挂在剧集下」的隐式结构（扫描器允许这种摆放）。
 */
export function listSeriesEpisodes(libraryId: string, seriesId: string): SeriesEpisodeFile[] {
  const seasonIds = new Set(listSeasonItems(libraryId, seriesId).map((season) => season.id))
  return listItems(libraryId)
    .filter(
      (item) => item.type === 'episode' && (item.parentId === seriesId || seasonIds.has(item.parentId))
    )
    .map((item): SeriesEpisodeFile => {
      const source = listSourcesByItem(item.id).find((row) => row.path === item.path)
      return {
        itemId: item.id,
        seasonItemId: seasonIds.has(item.parentId) ? item.parentId : '',
        seasonNumber: item.seasonNumber,
        episodeNumber: item.episodeNumber,
        name: item.name,
        path: source?.path ?? item.path,
        size: source?.size ?? 0
      }
    })
    .sort((left, right) =>
      left.seasonNumber === right.seasonNumber
        ? left.episodeNumber - right.episodeNumber
        : left.seasonNumber - right.seasonNumber
    )
}
