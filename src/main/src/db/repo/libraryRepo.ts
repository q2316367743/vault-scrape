/**
 * 资料库仓储：`library` 与 `library_path` 两张表的读写与行映射。
 *
 * 契约：
 * - 只做 SQL 与行映射，业务校验（名称、刮削器、路径归属）在 `libraryStore`；
 * - 读库时一并取回它的全部目录，调用方不需要再查一次；
 * - `scrapers` 是 JSON 文本列，解析失败一律回落空数组。
 */
import { randomUUID } from 'node:crypto'
import { asc, eq, inArray } from 'drizzle-orm'
import { LIBRARY_TYPES } from '@common/types/library'
import type { LibraryType, MediaLibrary, MediaLibraryPath, MediaLibraryPathDraft } from '@common/types/library'
import { FILE_ROOT } from '@common/types/file'
import { normalizeRemotePath } from '@common/types/file/path'
import { db } from '../client'
import { libraryPathTable, libraryTable } from '../schema'
import type { LibraryPathRow, LibraryRow, LibraryRowInsert } from '../schema'

/** 新建 / 更新资料库时写入的配置字段（不含 id 与时间戳） */
export interface LibraryWriteInput {
  name: string
  type: LibraryType
  scrapers: string[]
  nsfwProtection: boolean
  /** 扫描时排除小于该体积（MB）的视频；0 表示不过滤 */
  minFileSizeMb: number
  /** 优先读取本地 NFO 与本地图片，只从互联网上补缺失的信息 */
  localFirst: boolean
  moveEnabled: boolean
  moveDirectory: string
}

/** 库类型白名单回落：脏数据（历史行、手工改库）一律当「影视」 */
function libraryTypeOf(raw: string): LibraryType {
  return LIBRARY_TYPES.find((type) => type === raw) ?? 'movie'
}

function parseScrapers(text: string): string[] {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
  } catch {
    return []
  }
}

function toLibraryPath(row: LibraryPathRow): MediaLibraryPath {
  return { id: row.id, connectionId: row.connectionId, path: row.path }
}

function toLibrary(row: LibraryRow, paths: MediaLibraryPath[]): MediaLibrary {
  return {
    id: row.id,
    name: row.name,
    type: libraryTypeOf(row.type),
    scrapers: parseScrapers(row.scrapers),
    paths,
    nsfwProtection: row.nsfwProtection,
    minFileSizeMb: row.minFileSizeMb,
    localFirst: row.localFirst,
    moveEnabled: row.moveEnabled,
    moveDirectory: row.moveDirectory,
    lastScanAt: row.lastScanAt,
    lastScrapeAt: row.lastScrapeAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

/** 一次取回这些库的全部目录，按 libraryId 分组 */
function pathsOf(libraryIds: readonly string[]): Map<string, MediaLibraryPath[]> {
  const grouped = new Map<string, MediaLibraryPath[]>()
  if (libraryIds.length === 0) return grouped
  const rows = db()
    .select()
    .from(libraryPathTable)
    .where(inArray(libraryPathTable.libraryId, [...libraryIds]))
    .orderBy(asc(libraryPathTable.createdAt), asc(libraryPathTable.path))
    .all()
  for (const row of rows) {
    const list = grouped.get(row.libraryId)
    if (list) list.push(toLibraryPath(row))
    else grouped.set(row.libraryId, [toLibraryPath(row)])
  }
  return grouped
}

/** 路径是否等于根路径或位于其下 */
export function isSameOrInsidePath(root: string, target: string): boolean {
  if (root === FILE_ROOT) return true
  return target === root || target.startsWith(`${root}/`)
}

export function listLibraries(): MediaLibrary[] {
  const rows = db().select().from(libraryTable).orderBy(asc(libraryTable.createdAt), asc(libraryTable.id)).all()
  const grouped = pathsOf(rows.map((row) => row.id))
  return rows.map((row) => toLibrary(row, grouped.get(row.id) ?? []))
}

export function listLibrariesByConnection(connectionId: string): MediaLibrary[] {
  const pathRows = db().select().from(libraryPathTable).where(eq(libraryPathTable.connectionId, connectionId)).all()
  if (pathRows.length === 0) return []
  const ids = [...new Set(pathRows.map((row) => row.libraryId))]
  const rows = db()
    .select()
    .from(libraryTable)
    .where(inArray(libraryTable.id, ids))
    .orderBy(asc(libraryTable.createdAt), asc(libraryTable.id))
    .all()
  const grouped = pathsOf(rows.map((row) => row.id))
  return rows.map((row) => toLibrary(row, grouped.get(row.id) ?? []))
}

export function getLibrary(id: string): MediaLibrary | null {
  const row = db().select().from(libraryTable).where(eq(libraryTable.id, id)).get()
  if (!row) return null
  const paths = db()
    .select()
    .from(libraryPathTable)
    .where(eq(libraryPathTable.libraryId, id))
    .orderBy(asc(libraryPathTable.createdAt), asc(libraryPathTable.path))
    .all()
  return toLibrary(row, paths.map(toLibraryPath))
}

export function listLibraryPaths(libraryId: string): MediaLibraryPath[] {
  return db()
    .select()
    .from(libraryPathTable)
    .where(eq(libraryPathTable.libraryId, libraryId))
    .orderBy(asc(libraryPathTable.createdAt), asc(libraryPathTable.path))
    .all()
    .map(toLibraryPath)
}

export function insertLibrary(input: LibraryWriteInput): MediaLibrary {
  const now = Date.now()
  const id = randomUUID()
  const row: LibraryRowInsert = {
    id,
    name: input.name,
    type: input.type,
    scrapers: JSON.stringify(input.scrapers),
    nsfwProtection: input.nsfwProtection,
    minFileSizeMb: input.minFileSizeMb,
    localFirst: input.localFirst,
    moveEnabled: input.moveEnabled,
    moveDirectory: input.moveDirectory,
    lastScanAt: 0,
    lastScrapeAt: 0,
    createdAt: now,
    updatedAt: now
  }
  db().insert(libraryTable).values(row).run()
  const created = getLibrary(id)
  if (!created) throw new Error('[library] 新建资料库后读回失败')
  return created
}

export function updateLibrary(id: string, input: LibraryWriteInput): MediaLibrary | null {
  const existing = getLibrary(id)
  if (!existing) return null
  db()
    .update(libraryTable)
    .set({
      name: input.name,
      type: input.type,
      scrapers: JSON.stringify(input.scrapers),
      nsfwProtection: input.nsfwProtection,
      minFileSizeMb: input.minFileSizeMb,
      localFirst: input.localFirst,
      moveEnabled: input.moveEnabled,
      moveDirectory: input.moveDirectory,
      updatedAt: Date.now()
    })
    .where(eq(libraryTable.id, id))
    .run()
  return getLibrary(id)
}

/** 整体替换一个库的媒体目录清单 */
export function replaceLibraryPaths(libraryId: string, drafts: readonly MediaLibraryPathDraft[]): void {
  const now = Date.now()
  db().delete(libraryPathTable).where(eq(libraryPathTable.libraryId, libraryId)).run()
  if (drafts.length === 0) return
  db()
    .insert(libraryPathTable)
    .values(
      drafts.map((draft) => ({
        id: randomUUID(),
        libraryId,
        connectionId: draft.connectionId,
        path: normalizeRemotePath(draft.path),
        createdAt: now
      }))
    )
    .run()
}

export function deleteLibrary(id: string): boolean {
  const existing = db().select({ id: libraryTable.id }).from(libraryTable).where(eq(libraryTable.id, id)).get()
  if (!existing) return false
  db().delete(libraryPathTable).where(eq(libraryPathTable.libraryId, id)).run()
  db().delete(libraryTable).where(eq(libraryTable.id, id)).run()
  return true
}

/**
 * 删除某连接：清掉它名下的媒体目录，目录被清空的库一并删除。
 *
 * 返回被删掉的资料库数量（只少了部分目录的库不算）。
 */
export function deleteLibrariesByConnection(connectionId: string): number {
  const affected = db().select().from(libraryPathTable).where(eq(libraryPathTable.connectionId, connectionId)).all()
  if (affected.length === 0) return 0
  db().delete(libraryPathTable).where(eq(libraryPathTable.connectionId, connectionId)).run()
  const ids = [...new Set(affected.map((row) => row.libraryId))]
  const remaining = db().select().from(libraryPathTable).where(inArray(libraryPathTable.libraryId, ids)).all()
  const alive = new Set(remaining.map((row) => row.libraryId))
  const orphanIds = ids.filter((id) => !alive.has(id))
  if (orphanIds.length === 0) return 0
  db().delete(libraryTable).where(inArray(libraryTable.id, orphanIds)).run()
  return orphanIds.length
}

export function patchLibrary(
  id: string,
  patch: Partial<Pick<MediaLibrary, 'lastScanAt' | 'lastScrapeAt'>>
): MediaLibrary | null {
  const existing = getLibrary(id)
  if (!existing) return null
  db()
    .update(libraryTable)
    .set({
      lastScanAt: patch.lastScanAt ?? existing.lastScanAt,
      lastScrapeAt: patch.lastScrapeAt ?? existing.lastScrapeAt,
      updatedAt: Date.now()
    })
    .where(eq(libraryTable.id, id))
    .run()
  return getLibrary(id)
}

/** 按「连接 + 目录」找拥有该路径（或它的上级）的库，取最长的那个目录；刮削任务恢复时用 */
export function findLibraryByPath(connectionId: string, dirPath: string): MediaLibrary | null {
  const libraries = listLibrariesByConnection(connectionId)
  let best: MediaLibrary | null = null
  let bestLength = -1
  for (const library of libraries) {
    for (const path of library.paths) {
      if (path.connectionId !== connectionId) continue
      if (!isSameOrInsidePath(path.path, dirPath)) continue
      if (path.path.length > bestLength) {
        best = library
        bestLength = path.path.length
      }
    }
  }
  return best
}
