/**
 * 资料库仓储：`library` 与 `library_path` 两张表的读写与行映射。
 *
 * 契约：
 * - 只做 SQL 与行映射，业务校验（名称、刮削器、路径归属）在 `libraryStore`；
 * - 读库时一并取回它的全部目录，调用方不需要再查一次；
 * - `scrapers` 是 JSON 文本列，解析失败一律回落空数组。
 */
import { randomUUID } from 'node:crypto'
import { LIBRARY_TYPES } from '@common/types/library'
import type {
  LibraryType,
  MediaLibrary,
  MediaLibraryPath,
  MediaLibraryPathDraft
} from '@common/types/library'
import { isTranslateLanguage } from '@common/types/plugin'
import type { TranslateLanguage } from '@common/types/setting/translateSetting'
import { FILE_ROOT } from '@common/types/file'
import { normalizeRemotePath } from '@common/types/file/path'
import { boolOf, transaction } from '../client'
import { LIBRARY_COLUMNS, LIBRARY_PATH_COLUMNS } from '../columns'
import { allOf, oneOf, placeholders, runOf, type SqlValue } from '../query'
import type { LibraryPathRow, LibraryRow } from '../schema'

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
  /** 该库内容的源语言；空串表示未设置 */
  language: TranslateLanguage | ''
}

/** 库类型白名单回落：脏数据（历史行、手工改库）一律当「影视」 */
function libraryTypeOf(raw: string): LibraryType {
  return LIBRARY_TYPES.find((type) => type === raw) ?? 'movie'
}

/** 语言白名单回落：空串与脏数据都当「未设置」 */
function languageOf(raw: string): TranslateLanguage | '' {
  return isTranslateLanguage(raw) ? raw : ''
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

/** SQL 行 → 领域行：SQLite 的 0/1 转成 boolean */
function toLibraryRow(row: LibraryRow): LibraryRow {
  return {
    ...row,
    nsfwProtection: boolOf(row.nsfwProtection),
    localFirst: boolOf(row.localFirst),
    moveEnabled: boolOf(row.moveEnabled)
  }
}

function toLibraryPath(row: LibraryPathRow): MediaLibraryPath {
  return { id: row.id, connectionId: row.connectionId, path: row.path }
}

function toLibrary(row: LibraryRow, paths: MediaLibraryPath[]): MediaLibrary {
  const typed = toLibraryRow(row)
  return {
    id: typed.id,
    name: typed.name,
    type: libraryTypeOf(typed.type),
    scrapers: parseScrapers(typed.scrapers),
    paths,
    nsfwProtection: typed.nsfwProtection,
    minFileSizeMb: typed.minFileSizeMb,
    localFirst: typed.localFirst,
    moveEnabled: typed.moveEnabled,
    moveDirectory: typed.moveDirectory,
    language: languageOf(typed.language),
    lastScanAt: typed.lastScanAt,
    lastScrapeAt: typed.lastScrapeAt,
    createdAt: typed.createdAt,
    updatedAt: typed.updatedAt
  }
}

/** 一次取回这些库的全部目录，按 libraryId 分组 */
function pathsOf(libraryIds: readonly string[]): Map<string, MediaLibraryPath[]> {
  const grouped = new Map<string, MediaLibraryPath[]>()
  if (libraryIds.length === 0) return grouped
  const rows = allOf<LibraryPathRow>(
    `SELECT ${LIBRARY_PATH_COLUMNS} FROM library_path
      WHERE library_id IN (${placeholders(libraryIds.length)})
      ORDER BY created_at ASC, path ASC`,
    [...libraryIds]
  )
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
  const rows = allOf<LibraryRow>(
    `SELECT ${LIBRARY_COLUMNS} FROM library ORDER BY created_at ASC, id ASC`
  )
  const grouped = pathsOf(rows.map((row) => row.id))
  return rows.map((row) => toLibrary(row, grouped.get(row.id) ?? []))
}

export function listLibrariesByConnection(connectionId: string): MediaLibrary[] {
  const pathRows = allOf<LibraryPathRow>(
    `SELECT ${LIBRARY_PATH_COLUMNS} FROM library_path WHERE connection_id = ?`,
    [connectionId]
  )
  if (pathRows.length === 0) return []
  const ids = [...new Set(pathRows.map((row) => row.libraryId))]
  const rows = allOf<LibraryRow>(
    `SELECT ${LIBRARY_COLUMNS} FROM library WHERE id IN (${placeholders(ids.length)})
      ORDER BY created_at ASC, id ASC`,
    ids
  )
  const grouped = pathsOf(rows.map((row) => row.id))
  return rows.map((row) => toLibrary(row, grouped.get(row.id) ?? []))
}

export function getLibrary(id: string): MediaLibrary | null {
  const row = oneOf<LibraryRow>(`SELECT ${LIBRARY_COLUMNS} FROM library WHERE id = ?`, [id])
  if (!row) return null
  const paths = allOf<LibraryPathRow>(
    `SELECT ${LIBRARY_PATH_COLUMNS} FROM library_path WHERE library_id = ?
      ORDER BY created_at ASC, path ASC`,
    [id]
  )
  return toLibrary(row, paths.map(toLibraryPath))
}

export function listLibraryPaths(libraryId: string): MediaLibraryPath[] {
  return allOf<LibraryPathRow>(
    `SELECT ${LIBRARY_PATH_COLUMNS} FROM library_path WHERE library_id = ?
      ORDER BY created_at ASC, path ASC`,
    [libraryId]
  ).map(toLibraryPath)
}

export function insertLibrary(input: LibraryWriteInput): MediaLibrary {
  const now = Date.now()
  const id = randomUUID()
  runOf(
    `INSERT INTO library (id, name, type, scrapers, nsfw_protection, min_file_size_mb,
      local_first, move_enabled, move_directory, language, last_scan_at, last_scrape_at,
      created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.type,
      JSON.stringify(input.scrapers),
      input.nsfwProtection ? 1 : 0,
      input.minFileSizeMb,
      input.localFirst ? 1 : 0,
      input.moveEnabled ? 1 : 0,
      input.moveDirectory,
      input.language,
      0,
      0,
      now,
      now
    ]
  )
  const created = getLibrary(id)
  if (!created) throw new Error('[library] 新建资料库后读回失败')
  return created
}

export function updateLibrary(id: string, input: LibraryWriteInput): MediaLibrary | null {
  const existing = getLibrary(id)
  if (!existing) return null
  runOf(
    `UPDATE library SET name = ?, type = ?, scrapers = ?, nsfw_protection = ?,
      min_file_size_mb = ?, local_first = ?, move_enabled = ?, move_directory = ?,
      language = ?, updated_at = ? WHERE id = ?`,
    [
      input.name,
      input.type,
      JSON.stringify(input.scrapers),
      input.nsfwProtection ? 1 : 0,
      input.minFileSizeMb,
      input.localFirst ? 1 : 0,
      input.moveEnabled ? 1 : 0,
      input.moveDirectory,
      input.language,
      Date.now(),
      id
    ]
  )
  return getLibrary(id)
}

/** 整体替换一个库的媒体目录清单 */
export function replaceLibraryPaths(
  libraryId: string,
  drafts: readonly MediaLibraryPathDraft[]
): void {
  const now = Date.now()
  transaction(() => {
    runOf('DELETE FROM library_path WHERE library_id = ?', [libraryId])
    for (const draft of drafts) {
      runOf(
        `INSERT INTO library_path (id, library_id, connection_id, path, created_at)
          VALUES (?, ?, ?, ?, ?)`,
        [randomUUID(), libraryId, draft.connectionId, normalizeRemotePath(draft.path), now]
      )
    }
  })
}

export function deleteLibrary(id: string): boolean {
  const existing = oneOf<{ id: string }>('SELECT id FROM library WHERE id = ?', [id])
  if (!existing) return false
  transaction(() => {
    runOf('DELETE FROM library_path WHERE library_id = ?', [id])
    runOf('DELETE FROM library WHERE id = ?', [id])
  })
  return true
}

/**
 * 删除某连接：清掉它名下的媒体目录，目录被清空的库一并删除。
 *
 * 返回被删掉的资料库数量（只少了部分目录的库不算）。
 */
export function deleteLibrariesByConnection(connectionId: string): number {
  const affected = allOf<LibraryPathRow>(
    `SELECT ${LIBRARY_PATH_COLUMNS} FROM library_path WHERE connection_id = ?`,
    [connectionId]
  )
  if (affected.length === 0) return 0
  runOf('DELETE FROM library_path WHERE connection_id = ?', [connectionId])
  const ids = [...new Set(affected.map((row) => row.libraryId))]
  const remaining = allOf<LibraryPathRow>(
    `SELECT ${LIBRARY_PATH_COLUMNS} FROM library_path
      WHERE library_id IN (${placeholders(ids.length)})`,
    ids
  )
  const alive = new Set(remaining.map((row) => row.libraryId))
  const orphanIds = ids.filter((id) => !alive.has(id))
  if (orphanIds.length === 0) return 0
  runOf(
    `DELETE FROM library WHERE id IN (${placeholders(orphanIds.length)})`,
    orphanIds as SqlValue[]
  )
  return orphanIds.length
}

export function patchLibrary(
  id: string,
  patch: Partial<Pick<MediaLibrary, 'lastScanAt' | 'lastScrapeAt'>>
): MediaLibrary | null {
  const existing = getLibrary(id)
  if (!existing) return null
  runOf('UPDATE library SET last_scan_at = ?, last_scrape_at = ?, updated_at = ? WHERE id = ?', [
    patch.lastScanAt ?? existing.lastScanAt,
    patch.lastScrapeAt ?? existing.lastScrapeAt,
    Date.now(),
    id
  ])
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
