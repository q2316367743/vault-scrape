/**
 * 离线库（r18.db）的只读查询层。
 *
 * 契约：
 * 1. 独立句柄、只读打开（readonly + fileMustExist），**绝不 ATTACH 系统库**；
 *    r18.db 被删或损坏只影响离线刮削结果，系统数据不受影响；
 * 2. 未安装数据包时 search 返回空数组（保底方案：没装就当没有结果，不报错），
 *    detail / covers / extras 抛 `offlineMissing` 让调用方给出可读提示；
 * 3. 任何 SQLite 异常都映射成 PluginError：损坏 → offlineCorrupt，其余 → invokeFailed。
 */
import { existsSync } from 'node:fs'
import Database from 'better-sqlite3'
import { PluginError } from '@common/types/plugin'
import type { PluginAsset, PluginMovieCandidate, PluginMovieDetail } from '@common/types/plugin'
import { isNewerPackDate, type OfflinePackStatus } from '@common/types/offline'
import { offlineDbPath, offlineDbSize, readOfflineState, saveOfflineState } from './offlineFileStore'
import {
  asRow,
  coverAssets,
  emptyDetailRefs,
  extraAssets,
  normalizeContentId,
  normalizeNum,
  pickBestRow,
  readText,
  readVideoRow,
  scoreVideoRow,
  toCandidate,
  toDetail,
  type OfflineDetailRefs,
  type OfflineVideoRow
} from './offlineMapper'
import { OFFLINE_DB_SCHEMA_VERSION, OFFLINE_META_TABLE } from './offlineSchema'

/** 离线库自带的元数据（offline_meta 表） */
export interface OfflineMeta {
  schemaVersion: number
  packDate: string
  importedAt: number
  videoCount: number
  sourceUrl: string
}

/** 单次查询最多取回的行数（同一作品多站点会有多行） */
const ROW_SCAN_LIMIT = 50

let handle: Database.Database | null = null

/** 关闭只读句柄（导入替换库文件前必须调用） */
export function closeOfflineDb(): void {
  if (!handle) return
  try {
    handle.close()
  } catch {
    // 关闭失败无需处理，句柄随后丢弃
  }
  handle = null
}

function mapDbError(error: unknown): PluginError {
  if (error instanceof PluginError) return error
  const message = error instanceof Error ? error.message : String(error)
  if (/not a database|malformed|SQLITE_CORRUPT|no such table|no such column/i.test(message)) {
    return new PluginError('offlineCorrupt', '离线数据包已损坏，请重新导入')
  }
  if (/SQLITE_BUSY|database is locked/i.test(message)) {
    return new PluginError('invokeFailed', '离线数据包正忙，请稍后重试')
  }
  return new PluginError('invokeFailed', `离线数据包查询失败：${message}`)
}

function ensureHandle(): Database.Database {
  if (handle) return handle
  const dbPath = offlineDbPath()
  if (!existsSync(dbPath)) throw new PluginError('offlineMissing')
  try {
    handle = new Database(dbPath, { readonly: true, fileMustExist: true })
    return handle
  } catch (error) {
    handle = null
    throw mapDbError(error)
  }
}

/** 读取 offline_meta（表缺失 / 结构异常会抛错，由调用方映射） */
export function readOfflineMeta(db: Database.Database): OfflineMeta {
  const values = new Map<string, string>()
  for (const raw of db.prepare(`SELECT key, value FROM ${OFFLINE_META_TABLE}`).all()) {
    const row = asRow(raw)
    values.set(readText(row, 'key'), readText(row, 'value'))
  }
  const readValue = (key: string): string => values.get(key) ?? ''
  const schemaVersion = Number.parseInt(readValue('schema_version'), 10)
  const importedAt = Number.parseInt(readValue('imported_at'), 10)
  const videoCount = Number.parseInt(readValue('video_count'), 10)
  return {
    schemaVersion: Number.isFinite(schemaVersion) ? schemaVersion : 0,
    packDate: readValue('pack_date'),
    importedAt: Number.isFinite(importedAt) ? importedAt : 0,
    videoCount: Number.isFinite(videoCount) ? videoCount : 0,
    sourceUrl: readValue('source_url')
  }
}

interface OpenResult {
  db: Database.Database
  meta: OfflineMeta
}

function openDb(): OpenResult {
  const db = ensureHandle()
  let meta: OfflineMeta
  try {
    meta = readOfflineMeta(db)
  } catch (error) {
    closeOfflineDb()
    throw mapDbError(error)
  }
  if (meta.schemaVersion !== OFFLINE_DB_SCHEMA_VERSION) {
    closeOfflineDb()
    throw new PluginError('offlineCorrupt', '离线数据包版本不兼容，请重新导入')
  }
  return { db, meta }
}

/** 本地已安装数据包的日期；未安装或损坏时回落运行时状态里记录的日期 */
export function localPackDate(): string {
  const state = readOfflineState()
  try {
    return openDb().meta.packDate || state.packDate
  } catch {
    return state.packDate
  }
}

/** 离线数据包状态快照（绝不影响系统库；损坏时如实上报） */
export function offlineStatus(): OfflinePackStatus {
  const state = readOfflineState()
  const dbBytes = offlineDbSize()
  const dbPath = offlineDbPath()
  const base: OfflinePackStatus = {
    installed: false,
    packDate: state.packDate,
    importedAt: state.importedAt,
    videoCount: 0,
    dbBytes,
    sourceUrl: '',
    dbPath,
    lastCheckAt: state.lastCheckAt,
    latestPackDate: state.latestPackDate,
    updateAvailable: isNewerPackDate(state.latestPackDate, state.packDate),
    corrupt: state.corrupt
  }

  let meta: OfflineMeta
  try {
    meta = openDb().meta
  } catch (error) {
    const corrupt = error instanceof PluginError && error.code === 'offlineCorrupt'
    if (corrupt !== state.corrupt) saveOfflineState({ corrupt })
    return { ...base, corrupt }
  }

  const packDate = meta.packDate || state.packDate
  const importedAt = meta.importedAt > 0 ? meta.importedAt : state.importedAt
  if (
    state.packDate !== packDate ||
    state.importedAt !== importedAt ||
    state.dbBytes !== dbBytes ||
    state.corrupt
  ) {
    saveOfflineState({ packDate, importedAt, dbBytes, corrupt: false })
  }
  return {
    ...base,
    installed: true,
    packDate,
    importedAt,
    videoCount: meta.videoCount,
    sourceUrl: meta.sourceUrl,
    updateAvailable: isNewerPackDate(state.latestPackDate, packDate),
    corrupt: false
  }
}

/** LIKE 通配符转义，避免用户输入的 % / _ 变成通配 */
function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

function findRows(db: Database.Database, contentId: string): OfflineVideoRow[] {
  return db
    .prepare('SELECT * FROM derived_video WHERE content_id = ? LIMIT ?')
    .all(contentId, ROW_SCAN_LIMIT)
    .map((raw) => readVideoRow(raw))
}

function findBestRow(db: Database.Database, contentId: string): OfflineVideoRow | null {
  return pickBestRow(findRows(db, contentId))
}

/**
 * 离线搜索：先按番号（归一化精确 / 前缀 / content_id），再按标题子串。
 *
 * 结果按「番号精确 > 前缀 > 标题」排序，同级按信息完整度排序。
 */
export function offlineSearch(keyword: string, limit = 50): PluginMovieCandidate[] {
  const text = keyword.trim()
  if (text.length === 0) return []
  if (!existsSync(offlineDbPath())) return []
  try {
    const { db } = openDb()
    const norm = normalizeNum(text)
    const contentId = normalizeContentId(text)
    const merged = new Map<string, { row: OfflineVideoRow; rank: number }>()
    const collect = (rows: readonly unknown[], rankOf: (row: OfflineVideoRow) => number): void => {
      for (const raw of rows) {
        const row = readVideoRow(raw)
        if (row.contentId.length === 0) continue
        const rank = rankOf(row)
        const previous = merged.get(row.contentId)
        if (!previous || rank < previous.rank) merged.set(row.contentId, { row, rank })
      }
    }

    if (norm.length >= 2) {
      collect(
        db
          .prepare(
            'SELECT * FROM derived_video WHERE dvd_id_norm = ? OR content_id = ? OR (dvd_id_norm >= ? AND dvd_id_norm < ?) LIMIT 300'
          )
          .all(norm, contentId, norm, `${norm}\uffff`),
        (row) => {
          if (normalizeNum(row.dvdId) === norm) return 0
          if (row.contentId === contentId) return 1
          return 2
        }
      )
    }

    collect(
      db
        .prepare(
          "SELECT * FROM derived_video WHERE title_ja LIKE ? ESCAPE '\\' OR title_en LIKE ? ESCAPE '\\' LIMIT 200"
        )
        .all(likePattern(text), likePattern(text)),
      () => 3
    )

    return [...merged.values()]
      .sort(
        (left, right) =>
          left.rank - right.rank ||
          scoreVideoRow(right.row) - scoreVideoRow(left.row) ||
          left.row.dvdId.localeCompare(right.row.dvdId)
      )
      .slice(0, Math.max(1, limit))
      .map((item) => toCandidate(item.row))
  } catch (error) {
    throw mapDbError(error)
  }
}

function readDictionaryName(
  db: Database.Database,
  table: 'derived_maker' | 'derived_label' | 'derived_series',
  id: string
): string {
  if (id.length === 0) return ''
  const row = asRow(db.prepare(`SELECT name_ja, name_en FROM ${table} WHERE id = ?`).get(id))
  return readText(row, 'name_ja') || readText(row, 'name_en')
}

function loadRefs(db: Database.Database, contentId: string, row: OfflineVideoRow): OfflineDetailRefs {
  const refs = emptyDetailRefs()

  const actresses = db
    .prepare(
      'SELECT a.name_kanji, a.name_kana, a.name_romaji FROM derived_video_actress va JOIN derived_actress a ON a.id = va.actress_id WHERE va.content_id = ? ORDER BY CAST(va.ordinality AS INTEGER) LIMIT 100'
    )
    .all(contentId)
  for (const raw of actresses) {
    const item = asRow(raw)
    const name =
      readText(item, 'name_kanji') || readText(item, 'name_romaji') || readText(item, 'name_kana')
    if (name.length > 0) refs.actresses.push(name)
  }

  const categories = db
    .prepare(
      'SELECT c.name_ja, c.name_en FROM derived_video_category vc JOIN derived_category c ON c.id = vc.category_id WHERE vc.content_id = ? LIMIT 200'
    )
    .all(contentId)
  for (const raw of categories) {
    const item = asRow(raw)
    const name = readText(item, 'name_ja') || readText(item, 'name_en')
    if (name.length > 0) refs.categories.push(name)
  }

  const directors = db
    .prepare(
      'SELECT d.name_kanji, d.name_kana, d.name_romaji FROM derived_video_director vd JOIN derived_director d ON d.id = vd.director_id WHERE vd.content_id = ? LIMIT 20'
    )
    .all(contentId)
  for (const raw of directors) {
    const item = asRow(raw)
    const name =
      readText(item, 'name_kanji') || readText(item, 'name_romaji') || readText(item, 'name_kana')
    if (name.length > 0) refs.directors.push(name)
  }

  refs.maker = readDictionaryName(db, 'derived_maker', row.makerId)
  refs.label = readDictionaryName(db, 'derived_label', row.labelId)
  refs.series = readDictionaryName(db, 'derived_series', row.seriesId)
  if (row.siteId.length > 0) {
    const site = asRow(db.prepare('SELECT name FROM derived_site WHERE id = ?').get(row.siteId))
    refs.site = readText(site, 'name')
  }
  return refs
}

export function offlineDetail(movieId: string): PluginMovieDetail {
  const contentId = normalizeContentId(movieId)
  if (contentId.length === 0) throw new PluginError('invalidArgument', '缺少作品 ID')
  try {
    const { db } = openDb()
    const row = findBestRow(db, contentId)
    if (!row) throw new PluginError('notFound', `离线数据包里没有 ${movieId}`)
    return toDetail(row, loadRefs(db, contentId, row))
  } catch (error) {
    throw mapDbError(error)
  }
}

export function offlineCovers(movieId: string): PluginAsset[] {
  const contentId = normalizeContentId(movieId)
  if (contentId.length === 0) return []
  try {
    const { db } = openDb()
    const row = findBestRow(db, contentId)
    return row ? coverAssets(row) : []
  } catch (error) {
    throw mapDbError(error)
  }
}

export function offlineExtras(movieId: string): PluginAsset[] {
  const contentId = normalizeContentId(movieId)
  if (contentId.length === 0) return []
  try {
    const { db } = openDb()
    const row = findBestRow(db, contentId)
    if (!row) return []
    const trailers: string[] = []
    const rows = db
      .prepare(
        "SELECT url FROM source_dmm_trailer WHERE content_id = ? AND url IS NOT NULL AND url <> '' LIMIT 20"
      )
      .all(contentId)
    for (const raw of rows) {
      const url = readText(asRow(raw), 'url')
      if (url.length > 0) trailers.push(url)
    }
    return extraAssets(row, trailers)
  } catch (error) {
    throw mapDbError(error)
  }
}
