/**
 * 资料库业务门面：校验、落库与级联清理。
 *
 * 契约：
 * - 配置真相在 SQLite（`library` / `library_path`），本文件不再持有 JSON 缓存；
 * - `scrapers` **可以为空**（空数组 = 该库不刮削），`paths` 必填非空，
 *   同一条「连接 + 路径」只能属于一个库，且不同库的目录之间不许互相嵌套
 *   （嵌套会让同一个文件被两个库争抢，Jellyfin 同样禁止重叠的资料库目录）；
 * - 删除库只删配置与库内条目，磁盘文件一律不动。
 */
import {
  countMovieItems,
  deleteItemsByConnection,
  deleteItemsByLibrary,
  deleteSourcesByConnection,
  deleteSourcesByLibrary,
  listItems,
  listMovieItems
} from '$/db/repo/mediaRepo'
import {
  deleteImagesByConnection,
  deleteImagesByLibrary,
  deleteImagesByItems,
  listImagesByLibrary
} from '$/db/repo/mediaImageRepo'
import type { MediaImageRow } from '$/db/schema/mediaImage'
import { basenameRemotePath, isRemotePathInside } from '@common/types/file'
import { buildMediaUrl } from '@common/types/media'
import {
  deleteLibrariesByConnection as removeLibrariesByConnection,
  deleteLibrary,
  getLibrary as readLibrary,
  insertLibrary,
  listLibraries as readLibraries,
  listLibrariesByConnection as readLibrariesByConnection,
  replaceLibraryPaths,
  updateLibrary
} from '$/db/repo/libraryRepo'
import { getConnection } from '$/modules/file/fileConnectionStore'
import { normalizeRemotePath } from '@common/types/file/path'
import { LIBRARY_IMAGE_SAVE_MODES, LIBRARY_TYPES } from '@common/types/library'
import type {
  LibraryImageSaveMode,
  LibraryType,
  MediaLibrary,
  MediaLibraryDraft,
  MediaLibraryPathDraft,
  MediaLibrarySummary
} from '@common/types/library'
import { LibraryError } from '@common/types/library'

const LIBRARY_NAME_MAX = 64

/** 库卡片封面拼贴最多几张 */
const COVER_URL_LIMIT = 4

function normalizeName(value: string): string {
  const name = (value ?? '').trim()
  if (name.length === 0) throw new LibraryError('invalidArgument', '资料库名称不能为空')
  return name.slice(0, LIBRARY_NAME_MAX)
}

/** 库类型白名单回落：非法值一律当「影视」 */
function normalizeType(value: LibraryType): LibraryType {
  return LIBRARY_TYPES.includes(value) ? value : 'movie'
}

/** 归一化刮削器清单：空数组表示这个库不刮削，不再是错误 */
function normalizeScrapers(values: readonly string[]): string[] {
  const unique = new Set<string>()
  for (const value of values ?? []) {
    const id = value.trim()
    if (id.length > 0) unique.add(id)
  }
  return [...unique]
}

function normalizePath(value: string): string {
  try {
    return normalizeRemotePath(value)
  } catch {
    throw new LibraryError('invalidArgument', `媒体目录不合法：${value}`)
  }
}

/**
 * 归一化并校验目录清单：去重 + 存储存在 + 不与任何库（含本库草稿）的目录重叠。
 *
 * 重叠 = 两个目录相同或互为父子。嵌套目录会让同一个文件被两个库争抢
 * （`media_source` 以「连接 + 路径」唯一），也会让被包含的库多出没有媒体源的
 * 孤儿条目、把计数撑大，所以一律拒绝（Jellyfin 也禁止重叠的资料库目录）。
 */
function normalizePaths(draft: MediaLibraryDraft): MediaLibraryPathDraft[] {
  const occupied = new Map<string, { path: string; libraryName: string }[]>()
  for (const library of readLibraries()) {
    if (library.id === draft.id) continue
    for (const item of library.paths) {
      const list = occupied.get(item.connectionId) ?? []
      list.push({ path: item.path, libraryName: library.name })
      occupied.set(item.connectionId, list)
    }
  }

  const seen = new Set<string>()
  const paths: MediaLibraryPathDraft[] = []
  for (const item of draft.paths ?? []) {
    const connectionId = (item.connectionId ?? '').trim()
    if (connectionId.length === 0) continue
    const path = normalizePath(item.path ?? '')
    const key = `${connectionId}\n${path}`
    if (seen.has(key)) throw new LibraryError('invalidArgument', `媒体目录重复添加：${path}`)
    if (!getConnection(connectionId)) {
      throw new LibraryError('connectionMissing', `存储不存在或已被删除：${connectionId}`)
    }
    for (const other of paths) {
      if (other.connectionId !== connectionId) continue
      if (isRemotePathInside(other.path, path) || isRemotePathInside(path, other.path)) {
        throw new LibraryError('invalidArgument', `媒体目录不能互相嵌套：${path} 与 ${other.path}`)
      }
    }
    for (const other of occupied.get(connectionId) ?? []) {
      if (isRemotePathInside(other.path, path) || isRemotePathInside(path, other.path)) {
        throw new LibraryError(
          'invalidArgument',
          `媒体目录与资料库「${other.libraryName}」的 ${other.path} 重叠，请改用不重叠的目录`
        )
      }
    }
    seen.add(key)
    paths.push({ connectionId, path })
  }
  if (paths.length === 0) throw new LibraryError('invalidArgument', '请至少添加一个媒体目录')
  return paths
}

function normalizeMoveDirectory(value: string): string {
  const text = (value ?? '').trim()
  return text.length === 0 ? '' : normalizePath(text)
}

function normalizeImageSaveMode(value: LibraryImageSaveMode): LibraryImageSaveMode {
  return LIBRARY_IMAGE_SAVE_MODES.includes(value) ? value : 'media'
}

export function listLibraries(): MediaLibrary[] {
  return readLibraries()
}

export function listLibrariesByConnection(connectionId: string): MediaLibrary[] {
  return readLibrariesByConnection(connectionId)
}

/** 条目 → primary 图（同一张图挂多个条目时以 primary 优先） */
function primaryImageOf(images: readonly MediaImageRow[]): Map<string, MediaImageRow> {
  const map = new Map<string, MediaImageRow>()
  for (const image of images) {
    const current = map.get(image.itemId)
    if (!current || (current.type !== 'primary' && image.type === 'primary')) map.set(image.itemId, image)
  }
  return map
}

/**
 * 库卡片的封面拼贴：按入库时间倒序取最近添加的 ≤4 张海报。
 *
 * 只用仓储函数（不能 import `mediaWall`，否则循环依赖）；封面规则与墙面一致：
 * 条目自己的 primary 图优先，没有就退回父目录条目的 primary 图。
 */
function coverUrlsOf(libraryId: string): string[] {
  const images = primaryImageOf(listImagesByLibrary(libraryId))
  const movies = [...listMovieItems(libraryId)].sort((left, right) => right.dateAdded - left.dateAdded)
  const urls: string[] = []
  const seen = new Set<string>()
  for (const item of movies) {
    const image = images.get(item.id) ?? (item.parentId.length > 0 ? images.get(item.parentId) : undefined)
    if (!image || seen.has(image.id)) continue
    seen.add(image.id)
    urls.push(buildMediaUrl(image.connectionId, image.id, basenameRemotePath(image.path)))
    if (urls.length >= COVER_URL_LIMIT) break
  }
  return urls
}

/** 带影片计数与封面拼贴的库摘要（影视墙筛选器、库列表与首页共用） */
export function listSummaries(): MediaLibrarySummary[] {
  return readLibraries().map((library) => ({
    ...library,
    videoCount: countMovieItems(library.id),
    coverUrls: coverUrlsOf(library.id)
  }))
}

export function getLibrary(id: string): MediaLibrary | null {
  return readLibrary(id)
}

/** 取库，不存在直接抛 notFound */
export function requireLibrary(id: string): MediaLibrary {
  const library = readLibrary(id)
  if (!library) throw new LibraryError('notFound', '资料库不存在')
  return library
}

export function saveLibrary(draft: MediaLibraryDraft): MediaLibrary {
  const input = {
    name: normalizeName(draft.name),
    type: normalizeType(draft.type),
    scrapers: normalizeScrapers(draft.scrapers),
    paths: normalizePaths(draft),
    nsfwProtection: draft.nsfwProtection !== false,
    writeNfo: draft.writeNfo !== false,
    renameEnabled: draft.renameEnabled === true,
    moveEnabled: draft.moveEnabled === true,
    moveDirectory: normalizeMoveDirectory(draft.moveDirectory),
    imageSaveMode: normalizeImageSaveMode(draft.imageSaveMode)
  }
  if (draft.id) {
    if (!readLibrary(draft.id)) throw new LibraryError('notFound', '资料库不存在')
    const updated = updateLibrary(draft.id, input)
    if (!updated) throw new LibraryError('notFound', '资料库不存在')
    replaceLibraryPaths(draft.id, input.paths)
    return requireLibrary(draft.id)
  }
  const created = insertLibrary(input)
  replaceLibraryPaths(created.id, input.paths)
  return requireLibrary(created.id)
}

/** 清掉一个库残留的媒体数据（条目、媒体源、图片） */
function purgeLibraryMedia(libraryId: string): void {
  const itemIds = listItems(libraryId).map((row) => row.id)
  deleteImagesByLibrary(libraryId)
  deleteImagesByItems(itemIds)
  deleteSourcesByLibrary(libraryId)
  deleteItemsByLibrary(libraryId)
}

export function removeLibrary(id: string): boolean {
  if (!readLibrary(id)) return false
  purgeLibraryMedia(id)
  return deleteLibrary(id)
}

/**
 * 删除某连接：清掉该连接的媒体数据与媒体目录，目录被清空的库一并删除。
 *
 * 返回被删掉的资料库数量。
 */
export function deleteLibrariesByConnection(connectionId: string): number {
  const affected = readLibrariesByConnection(connectionId).map((library) => library.id)
  deleteImagesByConnection(connectionId)
  deleteSourcesByConnection(connectionId)
  deleteItemsByConnection(connectionId)
  const removed = removeLibrariesByConnection(connectionId)
  for (const libraryId of affected) {
    if (!readLibrary(libraryId)) purgeLibraryMedia(libraryId)
  }
  return removed
}
