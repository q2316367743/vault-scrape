/**
 * 插件返回值的结构收窄。
 *
 * 契约：
 * - `invokePlugin` 返回的是联合类型（候选数组 / 详情 / 资源数组），主进程只按结构判定，
 *   不用断言绕过类型系统；
 * - 插件通过 vm 沙箱返回的对象来自另一个 realm，一律先 `toSource` 成宿主侧普通对象再读字段；
 * - 非法项**丢弃而不是报错**：单个插件的脏数据不应让整个文件刮削失败。
 */
import {
  PLUGIN_ASSET_KINDS,
  PLUGIN_ASSET_METHODS,
  type PluginAsset,
  type PluginAssetKind,
  type PluginAssetMethod,
  type PluginEpisodeRef,
  type PluginInvokeData,
  type PluginMovieCandidate,
  type PluginMovieDetail
} from '@common/types/plugin'
import { readNumber, readString, readStringArray, toSource } from '@common/types/setting/shared'

type Source = Record<string, unknown>

function records(data: unknown): Source[] {
  if (!Array.isArray(data)) return []
  const result: Source[] = []
  for (const item of data) {
    const source = toSource(item)
    if (source) result.push(source)
  }
  return result
}

/** 读可选字符串：空串视为「没填」 */
function optionalText(source: Source, key: string): string | undefined {
  const value = readString(source, key, '').trim()
  return value.length > 0 ? value : undefined
}

function toCandidate(source: Source): PluginMovieCandidate | null {
  const id = optionalText(source, 'id')
  const title = optionalText(source, 'title')
  if (!id || !title) return null
  const candidate: PluginMovieCandidate = { id, title }
  const num = optionalText(source, 'num')
  if (num) candidate.num = num
  const cover = optionalText(source, 'cover')
  if (cover) candidate.cover = cover
  const date = optionalText(source, 'date')
  if (date) candidate.date = date
  const actors = readStringArray(source, 'actors', [])
  if (actors.length > 0) candidate.actors = actors
  const isSeries = source.isSeries
  if (typeof isSeries === 'boolean') candidate.isSeries = isSeries
  const episodeCount = readNumber(source, 'episodeCount', 0)
  if (episodeCount > 0) candidate.episodeCount = episodeCount
  return candidate
}

function toEpisodeRef(source: Source): PluginEpisodeRef | undefined {
  const index = readNumber(source, 'index', 0)
  if (index <= 0) return undefined
  const ref: PluginEpisodeRef = { index }
  const id = optionalText(source, 'id')
  if (id) ref.id = id
  const title = optionalText(source, 'title')
  if (title) ref.title = title
  return ref
}

function toAsset(source: Source): PluginAsset | null {
  const url = optionalText(source, 'url')
  const kind = readString(source, 'kind', '')
  const matched = PLUGIN_ASSET_KINDS.find((item) => item === kind) as PluginAssetKind | undefined
  if (!url || !matched) return null
  const asset: PluginAsset = { kind: matched, url }
  const method = readString(source, 'method', '')
  const matchedMethod = PLUGIN_ASSET_METHODS.find((item) => item === method) as
    | PluginAssetMethod
    | undefined
  if (matchedMethod) asset.method = matchedMethod
  const headers = toSource(source.headers)
  if (headers) {
    const record: Record<string, string> = {}
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string') record[key] = value
    }
    if (Object.keys(record).length > 0) asset.headers = record
  }
  const body = optionalText(source, 'body')
  if (body) asset.body = body
  const name = optionalText(source, 'name')
  if (name) asset.name = name
  const episode = toSource(source.episode)
  if (episode) {
    const ref = toEpisodeRef(episode)
    if (ref) asset.episode = ref
  }
  return asset
}

/** 候选数组；不是数组时返回空数组 */
export function readCandidates(data: PluginInvokeData): PluginMovieCandidate[] {
  return records(data)
    .map((source) => toCandidate(source))
    .filter((item): item is PluginMovieCandidate => item !== null)
}

/** 影片详情；结果不是对象或缺 id/title 时返回 null */
export function readDetail(data: PluginInvokeData): PluginMovieDetail | null {
  if (Array.isArray(data)) return null
  const source = toSource(data)
  if (!source) return null
  const id = optionalText(source, 'id')
  const title = optionalText(source, 'title')
  if (!id || !title) return null

  const detail: PluginMovieDetail = { id, title }
  const textKeys = [
    'num',
    'originalTitle',
    'plot',
    'maker',
    'label',
    'studio',
    'series',
    'director',
    'releaseDate'
  ] as const
  for (const key of textKeys) {
    const value = optionalText(source, key)
    if (value) detail[key] = value
  }

  const actors = readStringArray(source, 'actors', [])
  if (actors.length > 0) detail.actors = actors
  const tags = readStringArray(source, 'tags', [])
  if (tags.length > 0) detail.tags = tags
  const duration = readNumber(source, 'duration', 0)
  if (duration > 0) detail.duration = duration

  const episodes: PluginMovieDetail['episodes'] = []
  for (const item of records(source.episodes)) {
    const index = readNumber(item, 'index', 0)
    if (index <= 0) continue
    const episode: NonNullable<PluginMovieDetail['episodes']>[number] = { index }
    const episodeId = optionalText(item, 'id')
    if (episodeId) episode.id = episodeId
    const episodeTitle = optionalText(item, 'title')
    if (episodeTitle) episode.title = episodeTitle
    const episodeDuration = readNumber(item, 'duration', 0)
    if (episodeDuration > 0) episode.duration = episodeDuration
    const releaseDate = optionalText(item, 'releaseDate')
    if (releaseDate) episode.releaseDate = releaseDate
    episodes.push(episode)
  }
  if (episodes.length > 0) detail.episodes = episodes
  return detail
}

/** 资源数组；不是数组时返回空数组 */
export function readAssets(data: PluginInvokeData): PluginAsset[] {
  return records(data)
    .map((source) => toAsset(source))
    .filter((item): item is PluginAsset => item !== null)
}
