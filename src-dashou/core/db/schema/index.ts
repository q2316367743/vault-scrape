/**
 * 数据库行类型（camelCase，与仓储返回形状一致）。
 *
 * 契约：
 * - 字段名是 SQL 列名 camelCase 化后的结果；SQL 查询统一用 `SELECT ... AS camelCase` 别名，
 *   仓储不再额外做一次字段映射；
 * - 布尔列（`nsfw_protection` / `local_first` / `move_enabled` / `locked`）在 SQLite 里是 0/1，
 *   由仓储的映射函数转成真正的 boolean；
 * - 表结构以 `src-dashou/assets/schema.sql` 为准。
 */
import type { ActorGender, ActorImageKind, ActorImageSource } from '@common/types/actor'
import type { LibraryType } from '@common/types/library'
import type { LogLevel } from '@common/types/log'
import type { MediaImageType } from '@common/types/media'
import type { ScrapeFileStatus } from '@common/types/scrape'
import type { TaskStatus } from '@common/types/task'

export interface LogRow {
  id: string
  level: LogLevel
  scope: string
  message: string
  detail: string
  createdAt: number
}

export interface TaskRow {
  id: string
  name: string
  status: TaskStatus
  connectionId: string
  dirPath: string
  total: number
  finished: number
  failed: number
  message: string
  createdAt: number
  updatedAt: number
}

export interface ScrapeFileRow {
  id: string
  taskId: string
  itemId: string
  path: string
  finalPath: string
  name: string
  keyword: string
  status: ScrapeFileStatus
  pluginId: string
  title: string
  message: string
  updatedAt: number
}

export interface LibraryRow {
  id: string
  name: string
  type: LibraryType
  scrapers: string
  nsfwProtection: boolean
  minFileSizeMb: number
  localFirst: boolean
  moveEnabled: boolean
  moveDirectory: string
  language: string
  lastScanAt: number
  lastScrapeAt: number
  createdAt: number
  updatedAt: number
}

export interface LibraryPathRow {
  id: string
  libraryId: string
  connectionId: string
  path: string
  createdAt: number
}

export interface MediaItemRow {
  id: string
  libraryId: string
  connectionId: string
  type: 'movie' | 'folder' | 'series' | 'season' | 'episode'
  parentId: string
  path: string
  name: string
  sortName: string
  originalTitle: string
  num: string
  seasonNumber: number
  episodeNumber: number
  overview: string
  tagline: string
  premiereDate: string
  productionYear: number
  runtimeMinutes: number
  officialRating: string
  communityRating: number
  genres: string
  studios: string
  tags: string
  providerIds: string
  maker: string
  label: string
  series: string
  director: string
  scraperId: string
  scrapedAt: number
  hasNfo: number
  dateAdded: number
  updatedAt: number
}

export interface MediaSourceRow {
  id: string
  itemId: string
  libraryId: string
  connectionId: string
  path: string
  name: string
  extname: string
  mime: string
  size: number
  modifiedAt: number
  indexedAt: number
  scanId: string
}

export interface MediaImageRow {
  id: string
  itemId: string
  libraryId: string
  type: MediaImageType
  connectionId: string
  path: string
  width: number
  height: number
  createdAt: number
}

export interface ActorRow {
  id: string
  name: string
  nameKey: string
  gender: ActorGender
  birthday: string
  birthCountry: string
  birthProvince: string
  birthCity: string
  birthCounty: string
  height: number
  bust: number
  waist: number
  hip: number
  cup: string
  tagline: string
  sourceUrl: string
  overview: string
  tags: string
  avatarImageId: string
  locked: boolean
  scraperId: string
  scrapedAt: number
  createdAt: number
  updatedAt: number
}

export interface ActorAliasRow {
  id: string
  actorId: string
  alias: string
  aliasKey: string
}

export interface ActorImageRow {
  id: string
  actorId: string
  kind: ActorImageKind
  path: string
  name: string
  extname: string
  mime: string
  size: number
  width: number
  height: number
  source: ActorImageSource
  createdAt: number
}

export interface MediaCastRow {
  itemId: string
  actorName: string
  nameKey: string
  ordinal: number
}

export interface MediaTranslationRow {
  itemId: string
  libraryId: string
  language: string
  sourceLanguage: string
  title: string
  originalTitle: string
  overview: string
  maker: string
  label: string
  series: string
  director: string
  tags: string
  actors: string
  pluginId: string
  translatedAt: number
}
