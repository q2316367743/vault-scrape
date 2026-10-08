/**
 * 插件返回值的归一化。
 *
 * 契约：
 * - 插件返回值来自另一个 vm realm 且可能是畸形数据：这里一律重建宿主 realm 的纯对象并逐字段校验；
 * - 非法项丢弃，单个列表超过 PLUGIN_LIST_LIMIT 条时截断并告警，本模块绝不抛错；
 * - 收窄一律走类型谓词，绝不引入 any 与多余的 as 断言。
 */
import { readNumber, readString, readStringArray, toSource } from '../setting/shared'
import {
  PLUGIN_ASSET_KINDS,
  PLUGIN_ASSET_METHODS,
  type PluginAsset,
  type PluginAssetKind,
  type PluginAssetMethod,
  type PluginEpisodeRef
} from './asset'
import { PLUGIN_ID_PATTERN, type PluginMeta } from './manifest'
import type { PluginEpisode, PluginMovieCandidate, PluginMovieDetail } from './movie'

/** 单个列表最多保留的条目数 */
export const PLUGIN_LIST_LIMIT = 500

function warn(message: string): void {
  console.warn(`[plugin] ${message}`)
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined
}

function isAssetKind(value: unknown): value is PluginAssetKind {
  return typeof value === 'string' && PLUGIN_ASSET_KINDS.some((kind) => kind === value)
}

function isAssetMethod(value: unknown): value is PluginAssetMethod {
  return typeof value === 'string' && PLUGIN_ASSET_METHODS.some((method) => method === value)
}

/** 原始值取数组；非数组按空列表处理 */
function toRawList(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : []
}

function limitList<T>(items: T[], label: string): T[] {
  if (items.length <= PLUGIN_LIST_LIMIT) return items
  warn(`${label} 返回 ${items.length} 条，超出上限 ${PLUGIN_LIST_LIMIT}，已截断`)
  return items.slice(0, PLUGIN_LIST_LIMIT)
}

/** 必填字符串：非字符串或空串视为非法 */
function required(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** 可选字符串：空串按未提供处理 */
function optional(source: Record<string, unknown>, key: string): string | undefined {
  const value = readString(source, key, '')
  return value.length > 0 ? value : undefined
}

function optionalBoolean(source: Record<string, unknown>, key: string): boolean | undefined {
  const value = source[key]
  return typeof value === 'boolean' ? value : undefined
}

/** 可选正整数 */
function optionalCount(source: Record<string, unknown>, key: string): number | undefined {
  const value = readNumber(source, key, 0, 1)
  return value > 0 ? Math.floor(value) : undefined
}

function optionalStringArray(source: Record<string, unknown>, key: string): string[] | undefined {
  const list = readStringArray(source, key, []).filter((item) => item.length > 0)
  return list.length > 0 ? list : undefined
}

function readHeaders(source: Record<string, unknown>): Record<string, string> | undefined {
  const raw = toSource(source.headers)
  if (!raw) return undefined
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' && value.length > 0) headers[key] = value
  }
  return Object.keys(headers).length > 0 ? headers : undefined
}

function normalizeEpisodeRef(raw: unknown): PluginEpisodeRef | undefined {
  const source = toSource(raw)
  if (!source) return undefined
  const index = optionalCount(source, 'index')
  if (index === undefined) return undefined
  return { id: optional(source, 'id'), index, title: optional(source, 'title') }
}

function normalizeEpisode(raw: unknown): PluginEpisode | null {
  const source = toSource(raw)
  if (!source) return null
  const index = optionalCount(source, 'index')
  if (index === undefined) return null
  return {
    id: optional(source, 'id'),
    index,
    title: optional(source, 'title'),
    duration: optionalCount(source, 'duration'),
    releaseDate: optional(source, 'releaseDate')
  }
}

/** 插件元信息：id / name / version 必填，id 必须符合命名规则（同时是源码文件名） */
export function normalizeMeta(raw: unknown): PluginMeta | null {
  const source = toSource(raw)
  if (!source) return null
  const id = required(source, 'id')
  const name = required(source, 'name')
  const version = required(source, 'version')
  if (id === null || name === null || version === null) return null
  if (!PLUGIN_ID_PATTERN.test(id)) return null
  return {
    id,
    name,
    version,
    author: optional(source, 'author'),
    description: optional(source, 'description'),
    prefixes: optionalStringArray(source, 'prefixes'),
    homepage: optional(source, 'homepage')
  }
}

/** 搜索候选：id 与 title 必填，其余字段非法即回落 undefined */
export function normalizeCandidate(raw: unknown): PluginMovieCandidate | null {
  const source = toSource(raw)
  if (!source) return null
  const id = required(source, 'id')
  const title = required(source, 'title')
  if (id === null || title === null) return null
  return {
    id,
    title,
    num: optional(source, 'num'),
    cover: optional(source, 'cover'),
    date: optional(source, 'date'),
    isSeries: optionalBoolean(source, 'isSeries'),
    episodeCount: optionalCount(source, 'episodeCount')
  }
}

/** 详情：title 必填；id 缺失时回落到调用方给出的影片 ID */
export function normalizeDetail(raw: unknown, fallbackId: string): PluginMovieDetail | null {
  const source = toSource(raw)
  if (!source) return null
  const title = required(source, 'title')
  if (title === null) return null
  const episodes = limitList(
    toRawList(source.episodes)
      .map(normalizeEpisode)
      .filter(isPresent),
    '详情剧集'
  )
  return {
    id: optional(source, 'id') ?? fallbackId,
    title,
    num: optional(source, 'num'),
    originalTitle: optional(source, 'originalTitle'),
    plot: optional(source, 'plot'),
    actors: optionalStringArray(source, 'actors'),
    maker: optional(source, 'maker'),
    label: optional(source, 'label'),
    studio: optional(source, 'studio'),
    series: optional(source, 'series'),
    director: optional(source, 'director'),
    releaseDate: optional(source, 'releaseDate'),
    duration: optionalCount(source, 'duration'),
    tags: optionalStringArray(source, 'tags'),
    episodes: episodes.length > 0 ? episodes : undefined
  }
}

/** 单条资产：kind 必须在允许范围内，url 必填 */
export function normalizeAsset(
  raw: unknown,
  kinds: readonly PluginAssetKind[]
): PluginAsset | null {
  const source = toSource(raw)
  if (!source) return null
  const kind = source.kind
  if (!isAssetKind(kind) || !kinds.some((item) => item === kind)) return null
  const url = required(source, 'url')
  if (url === null) return null
  return {
    kind,
    url,
    method: isAssetMethod(source.method) ? source.method : undefined,
    headers: readHeaders(source),
    body: optional(source, 'body'),
    name: optional(source, 'name'),
    episode: normalizeEpisodeRef(source.episode)
  }
}

/** 候选列表：非数组按空列表处理 */
export function normalizeCandidates(raw: unknown): PluginMovieCandidate[] {
  return limitList(
    toRawList(raw)
      .map(normalizeCandidate)
      .filter(isPresent),
    '搜索候选'
  )
}

/** 资产列表：非数组按空列表处理 */
export function normalizeAssets(raw: unknown, kinds: readonly PluginAssetKind[]): PluginAsset[] {
  return limitList(
    toRawList(raw)
      .map((item) => normalizeAsset(item, kinds))
      .filter(isPresent),
    '资源列表'
  )
}
