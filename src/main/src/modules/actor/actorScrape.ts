/**
 * 演员资料抓取：调用插件的可选 `actor` / `actorAssets` 钩子，把命中的资料与图片补进数据库。
 *
 * 契约：
 * - 只填空、不改用户：`locked` 为真时只填空白字段；姓名与用户标签永不被刮削覆盖，
 *   已有头像也不会被刮削图片顶掉（`saveActorImage` 会把新图存成图集）；
 * - 逐个插件依次尝试，命中一个就停；单个插件失败只记日志，不打断其它插件与调用方；
 * - 图片下载复用刮削域的 `downloadAssetToTemp`，落盘后立刻 `cleanup`；
 * - 刮削自动补全走模块级串行队列，同一演员在排队期间不会重复入队。
 */
import { basename, extname } from 'node:path'
import {
  ActorError,
  actorUniqueNames,
  isActorImageExtension,
  type ActorScrapeMissingResult,
  type ActorScrapeRequest,
  type ActorScrapeResult
} from '@common/types/actor'
import {
  PLUGIN_ASSET_KINDS,
  normalizeActorDetail,
  type PluginActorDetail,
  type PluginAsset,
  type PluginInvokeData
} from '@common/types/plugin'
import { toSource } from '@common/types/setting/shared'
import { appendLog } from '$/db/repo/logRepo'
import {
  getActor,
  listActorImages,
  listActorsByNames,
  listAliases,
  listIncompleteActors,
  replaceAliases,
  updateActor,
  type ActorProfilePatch
} from '$/db/repo/actorRepo'
import type { ActorRow } from '$/db/schema'
import { actorPlugins } from '$/modules/plugin/pluginRegistries'
import { downloadAssetToTemp, type AssetDownload } from '$/modules/scrape/scrapeAssets'
import { loadSetting } from '$/modules/setting/settingStore'
import { syncItemCast } from './actorLink'
import { saveActorImage } from './actorAsset'

/** 「抓取缺失资料」一次最多排队的演员数 */
export const ACTOR_SCRAPE_MISSING_LIMIT = 200

type ActorFieldKey =
  | 'aliases'
  | 'gender'
  | 'birthday'
  | 'birthCountry'
  | 'birthProvince'
  | 'birthCity'
  | 'birthCounty'
  | 'height'
  | 'bust'
  | 'waist'
  | 'hip'
  | 'cup'
  | 'tagline'
  | 'sourceUrl'
  | 'overview'

const LABEL: Readonly<Record<ActorFieldKey, string>> = {
  aliases: '别名',
  gender: '性别',
  birthday: '生日',
  birthCountry: '国家',
  birthProvince: '省州',
  birthCity: '城市',
  birthCounty: '区县',
  height: '身高',
  bust: '胸围',
  waist: '腰围',
  hip: '臀围',
  cup: '罩杯',
  tagline: '标语',
  sourceUrl: '来源链接',
  overview: '简介'
}

interface FillState {
  patch: ActorProfilePatch
  filled: string[]
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}

/** 已启用的「演员信息」插件 ID；真正能不能抓由调用结果决定（没有钩子的插件会报错跳过） */
function enabledPluginIds(): string[] {
  return actorPlugins
    .listPluginSummaries()
    .filter((summary) => summary.enabled)
    .map((summary) => summary.id)
}

function isAssetLike(value: unknown): boolean {
  const source = toSource(value)
  if (!source) return false
  const rawKind = typeof source.kind === 'string' ? source.kind : ''
  return PLUGIN_ASSET_KINDS.some((kind) => kind === rawKind) && typeof source.url === 'string'
}

/**
 * 演员钩子的返回值由 pluginRuntime 归一化过，这里只把联合类型收窄到资源列表。
 * 收窄条件同时校验 kind 与 url，所以不会把影片候选误当成资源。
 */
function isAssetList(value: PluginInvokeData): value is PluginAsset[] {
  return Array.isArray(value) && value.every(isAssetLike)
}

async function readActorDetail(pluginId: string, name: string): Promise<PluginActorDetail | null> {
  try {
    const data = await actorPlugins.invokePlugin(pluginId, 'actor', { actorName: name })
    return Array.isArray(data) ? null : normalizeActorDetail(data, '')
  } catch (error) {
    appendLog({
      level: 'warn',
      scope: 'actor',
      message: `插件 ${pluginId} 获取「${name}」的资料失败：${describeError(error)}`
    })
    return null
  }
}

async function readActorAssets(pluginId: string, name: string): Promise<PluginAsset[]> {
  try {
    const data = await actorPlugins.invokePlugin(pluginId, 'actorAssets', { actorName: name })
    return isAssetList(data) ? data : []
  } catch (error) {
    appendLog({
      level: 'warn',
      scope: 'actor',
      message: `插件 ${pluginId} 获取「${name}」的图片失败：${describeError(error)}`
    })
    return []
  }
}

/** 文本字段合并：空值不填；未锁定且已有内容时覆盖 */
function betterText(incoming: string | undefined, current: string, overwrite: boolean): string | undefined {
  const value = incoming?.trim() ?? ''
  if (value.length === 0) return undefined
  if (!overwrite && current.trim().length > 0) return undefined
  return value
}

/** 数值字段合并：非正数视为未提供；未锁定且已有数值时覆盖 */
function betterCount(
  incoming: number | undefined,
  current: number,
  overwrite: boolean
): number | undefined {
  if (incoming === undefined || incoming <= 0) return undefined
  if (!overwrite && current > 0) return undefined
  return incoming
}

/** 逐字段合并插件给的资料；姓名与用户标签不在这里（前者是身份键，后者永远归用户） */
function mergeActorDetail(detail: PluginActorDetail, actor: ActorRow, state: FillState): void {
  const overwrite = !actor.locked
  const gender = detail.gender
  if (gender && (overwrite || actor.gender === '')) {
    state.patch.gender = gender
    state.filled.push(LABEL.gender)
  }
  const birthday = betterText(detail.birthday, actor.birthday, overwrite)
  if (birthday) {
    state.patch.birthday = birthday
    state.filled.push(LABEL.birthday)
  }
  const birthCountry = betterText(detail.birthCountry, actor.birthCountry, overwrite)
  if (birthCountry) {
    state.patch.birthCountry = birthCountry
    state.filled.push(LABEL.birthCountry)
  }
  const birthProvince = betterText(detail.birthProvince, actor.birthProvince, overwrite)
  if (birthProvince) {
    state.patch.birthProvince = birthProvince
    state.filled.push(LABEL.birthProvince)
  }
  const birthCity = betterText(detail.birthCity, actor.birthCity, overwrite)
  if (birthCity) {
    state.patch.birthCity = birthCity
    state.filled.push(LABEL.birthCity)
  }
  const birthCounty = betterText(detail.birthCounty, actor.birthCounty, overwrite)
  if (birthCounty) {
    state.patch.birthCounty = birthCounty
    state.filled.push(LABEL.birthCounty)
  }
  const height = betterCount(detail.height, actor.height, overwrite)
  if (height) {
    state.patch.height = height
    state.filled.push(LABEL.height)
  }
  const bust = betterCount(detail.bust, actor.bust, overwrite)
  if (bust) {
    state.patch.bust = bust
    state.filled.push(LABEL.bust)
  }
  const waist = betterCount(detail.waist, actor.waist, overwrite)
  if (waist) {
    state.patch.waist = waist
    state.filled.push(LABEL.waist)
  }
  const hip = betterCount(detail.hip, actor.hip, overwrite)
  if (hip) {
    state.patch.hip = hip
    state.filled.push(LABEL.hip)
  }
  const cup = betterText(detail.cup, actor.cup, overwrite)
  if (cup) {
    state.patch.cup = cup
    state.filled.push(LABEL.cup)
  }
  const tagline = betterText(detail.tagline, actor.tagline, overwrite)
  if (tagline) {
    state.patch.tagline = tagline
    state.filled.push(LABEL.tagline)
  }
  const sourceUrl = betterText(detail.sourceUrl, actor.sourceUrl, overwrite)
  if (sourceUrl) {
    state.patch.sourceUrl = sourceUrl
    state.filled.push(LABEL.sourceUrl)
  }
  const overview = betterText(detail.overview, actor.overview, overwrite)
  if (overview) {
    state.patch.overview = overview
    state.filled.push(LABEL.overview)
  }
}

/** 别名合并：锁定后只追加，未锁定按插件给的替换（插件没给就不动） */
function mergeAliases(detail: PluginActorDetail, actor: ActorRow, state: FillState): string[] | null {
  const incoming = actorUniqueNames(detail.aliases ?? [])
  if (incoming.length === 0) return null
  const current = listAliases(actor.id).map((row) => row.alias)
  const next = actor.locked ? actorUniqueNames([...current, ...incoming]) : incoming
  const changed =
    next.length !== current.length || next.some((alias, index) => alias !== current[index])
  if (!changed) return null
  state.filled.push(LABEL.aliases)
  return next
}

/** url 路径的最后一段（解码后）；解析失败返回空串 */
function assetUrlName(asset: PluginAsset): string {
  try {
    return decodeURIComponent(basename(new URL(asset.url).pathname))
  } catch {
    return ''
  }
}

/**
 * 图片扩展名：url 末段优先。
 * 插件的 `name` 是展示名（如「头像」「剧照 2」），按契约不带扩展名，所以只作兜底。
 */
function assetExtension(asset: PluginAsset): string {
  for (const candidate of [assetUrlName(asset), asset.name ?? '']) {
    const extension = extname(candidate).toLowerCase().replace(/^\./, '')
    if (isActorImageExtension(extension)) return extension
  }
  return ''
}

/** 图片展示名：插件给的优先，否则取 url 末段 */
function assetDisplayName(asset: PluginAsset): string {
  const given = asset.name?.trim() ?? ''
  return given.length > 0 ? given : assetUrlName(asset)
}

/** 下载并保存插件给的演员图片：头像最多一张，图集受 `scrape.actorImageLimit` 限制 */
async function applyActorAssets(
  actorId: string,
  assets: readonly PluginAsset[],
  signal: AbortSignal
): Promise<number> {
  const limit = Math.max(0, Math.floor(loadSetting().scrape.actorImageLimit))
  if (assets.length === 0 || limit === 0) return 0
  const existing = listActorImages(actorId)
  let hasAvatar = existing.some((row) => row.kind === 'avatar')
  let photos = existing.filter((row) => row.kind !== 'avatar').length
  let saved = 0
  for (const asset of assets) {
    if (signal.aborted) break
    const isAvatar = asset.kind === 'poster'
    if (isAvatar && hasAvatar) continue
    if (!isAvatar && photos >= limit) continue
    const extension = assetExtension(asset)
    if (extension.length === 0) {
      appendLog({
        level: 'warn',
        scope: 'actor',
        message: `跳过无法识别格式的演员图片：${asset.url}`
      })
      continue
    }
    let download: AssetDownload | null = null
    try {
      download = await downloadAssetToTemp(asset, signal)
      saveActorImage({
        actorId,
        sourcePath: download.localPath,
        kind: isAvatar ? 'avatar' : 'photo',
        source: 'scrape',
        name: assetDisplayName(asset),
        extension
      })
      saved += 1
      if (isAvatar) hasAvatar = true
      else photos += 1
    } catch (error) {
      appendLog({
        level: 'warn',
        scope: 'actor',
        message: `演员图片保存失败：${describeError(error)}`
      })
    } finally {
      if (download) await download.cleanup()
    }
  }
  return saved
}

function describeResult(filled: readonly string[], images: number): string {
  const parts: string[] = []
  if (filled.length > 0) parts.push(`已补全 ${filled.join('、')}`)
  if (images > 0) parts.push(`已保存 ${images} 张图片`)
  return parts.length > 0 ? parts.join('，') : '插件命中了这位演员，但没有可补充的内容'
}

async function scrapeActorOnce(
  actorId: string,
  pluginIds: readonly string[],
  signal: AbortSignal
): Promise<ActorScrapeResult> {
  const actor = getActor(actorId)
  if (!actor) throw new ActorError('notFound')
  const ids = pluginIds.length > 0 ? [...pluginIds] : enabledPluginIds()
  if (ids.length === 0) {
    return { filled: [], images: 0, message: '没有可用的刮削插件，请先启用实现了演员钩子的插件' }
  }

  const state: FillState = { patch: {}, filled: [] }
  let aliases: string[] | null = null
  let assets: PluginAsset[] = []
  let hit = ''
  for (const id of ids) {
    if (signal.aborted) throw new ActorError('cancelled')
    const detail = await readActorDetail(id, actor.name)
    if (!detail) continue
    hit = id
    mergeActorDetail(detail, actor, state)
    aliases = mergeAliases(detail, actor, state)
    assets = await readActorAssets(id, actor.name)
    break
  }
  if (hit.length === 0) {
    return { filled: [], images: 0, message: `没有插件命中「${actor.name}」的资料` }
  }

  updateActor(actor.id, { ...state.patch, scraperId: hit, scrapedAt: Date.now() })
  if (aliases) replaceAliases(actor.id, aliases)
  const images = await applyActorAssets(actor.id, assets, signal)
  return { filled: state.filled, images, message: describeResult(state.filled, images) }
}

/** 手动抓取一位演员：`pluginIds` 为空表示用全部启用的插件 */
export function scrapeActor(
  request: ActorScrapeRequest,
  signal: AbortSignal
): Promise<ActorScrapeResult> {
  return scrapeActorOnce(request.actorId, request.pluginIds, signal)
}

let queue: Promise<void> = Promise.resolve()
const queued = new Set<string>()

/** 把演员排进串行抓取队列（刮削入库后自动补全用）；返回本次真正入队的数量 */
export function enqueueActorScrape(actorIds: readonly string[], signal?: AbortSignal): number {
  let count = 0
  for (const actorId of actorIds) {
    if (actorId.length === 0 || queued.has(actorId)) continue
    queued.add(actorId)
    count += 1
    queue = queue.then(async (): Promise<void> => {
      try {
        if (signal?.aborted) return
        const result = await scrapeActorOnce(actorId, [], signal ?? new AbortController().signal)
        const detail = result.filled.length > 0 ? result.filled.join('、') : '无字段'
        if (result.filled.length > 0 || result.images > 0) {
          appendLog({
            level: 'info',
            scope: 'actor',
            message: `自动补全演员资料（${detail}，${result.images} 张图片）`
          })
        }
      } catch (error) {
        if (!(error instanceof ActorError && error.code === 'cancelled')) {
          appendLog({
            level: 'warn',
            scope: 'actor',
            message: `自动抓取演员资料失败：${describeError(error)}`
          })
        }
      } finally {
        queued.delete(actorId)
      }
    })
  }
  return count
}

/**
 * 刮削入库后的演员接线：把影片的参演名单写进 `media_cast`（弱关联，按名字），
 * 并按设置为资料不全的演员排队补全。
 *
 * 契约：
 * - 名单为空时不动关联：元数据的重刮不该把已经挂好的名单清掉；
 * - 名单里的名字都会先落成演员档案（只有姓名），否则影视详情页的演员条点不进去；
 * - `enabled` 为假时只挂关联、不抓资料；
 * - 返回真正入队的演员数，调用方不等队列跑完。
 */
export function enqueueItemActorScrape(
  itemId: string,
  names: readonly string[],
  enabled: boolean,
  signal?: AbortSignal
): number {
  if (names.length === 0) return 0
  const cast = syncItemCast(itemId, names)
  if (!enabled) return 0
  const targets = listActorsByNames(cast.names)
    .filter((actor) => actor.scrapedAt === 0 || actor.avatarImageId === '' || actor.birthday === '')
    .map((actor) => actor.id)
  return enqueueActorScrape(targets, signal)
}

/** 批量抓取资料不全的演员 */
export function scrapeMissingActors(
  limit: number,
  signal?: AbortSignal
): ActorScrapeMissingResult {
  const rows = listIncompleteActors(Math.max(1, Math.floor(limit)))
  const total = enqueueActorScrape(
    rows.map((row) => row.id),
    signal
  )
  return {
    queued: total,
    message: total > 0 ? `已把 ${total} 位演员排进抓取队列` : '没有需要补全资料的演员'
  }
}
