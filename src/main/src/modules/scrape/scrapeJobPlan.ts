/**
 * 刮削单文件流水线的「收集与落盘」步骤：插件候选收集、资源下载、本地图片就位。
 *
 * 契约：只通过 `context.client` / `context.log` 与外界交互，不直接读写数据库。
 */
import { FILE_ROOT, dirnameRemotePath, joinRemotePath } from '@common/types/file'
import type { MediaImageType } from '@common/types/media'
import type { PluginAsset, PluginAssetKind, PluginMovieCandidate, PluginMovieDetail } from '@common/types/plugin'
import { COVER_ASSET_KINDS, EXTRA_ASSET_KINDS } from '@common/types/plugin'
import type { SettingNaming } from '@common/types/setting'
import {
  ScrapeError,
  normalizePartToken,
  partTokenOf,
  renderTemplate,
  resolveAssetName,
  sanitizeName,
  truncateName,
  type NfoArtwork,
  type ScrapeAssetContext
} from '@common/types/scrape'
import { moviePlugins } from '$/modules/plugin/pluginRegistries'
import { downloadAssetToTemp } from './scrapeAssets'
import type { LocalImage } from './scrapeLocalMeta'
import { pickCandidate } from './scrapeMatcher'
import { readAssets, readCandidates, readDetail } from './scrapePluginData'
import type { ScrapeJobContext } from './scrapeJobTypes'

/** 插件资源 / 本地图片 → 媒体图片类型；不在表里的（预告片）只落盘不入库 */
export const IMAGE_KIND_TYPE: Partial<Record<PluginAssetKind, MediaImageType>> = {
  poster: 'primary',
  thumb: 'thumb',
  fanart: 'backdrop',
  banner: 'banner',
  logo: 'logo',
  still: 'still'
}

/** 只保留一份的图片 kind：多版本会导致文件名互相覆盖 */
export const SINGLE_KINDS: ReadonlySet<PluginAssetKind> = new Set([
  'poster',
  'thumb',
  'fanart',
  'banner',
  'logo'
])

/** 已经就位的资源（本地沿用的与刚下载的共用一套记录） */
export interface PlantedAsset {
  kind: PluginAssetKind
  /** 相对影片目录的路径 */
  relativePath: string
  /** 连接内绝对路径 */
  path: string
  imageType?: MediaImageType
  /** 本地沿用的图片搬进影片目录前的位置（连接内绝对路径）；联网下载的没有这一项 */
  origin?: string
  /** 本次真的往磁盘写下过这个文件（下载成功）；沿用磁盘上已有文件（保留设置跳过）时没有这一项 */
  created?: boolean
}

/** 去掉扩展名 */
export function baseNameOf(name: string): string {
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(0, index) : name
}

/** 扩展名（含点），没有扩展名时为空串 */
export function extensionOf(name: string): string {
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(index) : ''
}

/**
 * 按命名规则算出影片基础名（文件夹名 / 视频文件名 / NFO 文件名三处共用）。
 *
 * 模板渲染为空时回落原名；分盘标记（CD1 / PART2…）始终按 `partStyle` 附在末尾，
 * 否则同名模板会让同一部作品的分盘文件互相覆盖。
 */
export function resolveVideoBase(
  detail: PluginMovieDetail,
  originalBase: string,
  naming: SettingNaming
): string {
  const rendered = renderTemplate(naming.fileTemplate, detail, naming)
  const base = truncateName(sanitizeName(rendered) || originalBase, naming.fileNameMaxLength)
  const token = normalizePartToken(partTokenOf(originalBase), naming.partStyle)
  if (token.length === 0) return base
  return truncateName(`${base} ${token}`, naming.fileNameMaxLength)
}

/** 启用的 kind 是否已经齐全（本地已有的也算齐全） */
function isSatisfied(
  detail: PluginMovieDetail | null,
  assets: ReadonlyMap<PluginAssetKind, PluginAsset[]>,
  enabled: readonly PluginAssetKind[],
  localKinds: ReadonlySet<PluginAssetKind>
): boolean {
  if (!detail) return false
  return enabled.every((kind) => localKinds.has(kind) || (assets.get(kind)?.length ?? 0) > 0)
}

/** 收集一个插件的资源，只接受尚未拿到的启用 kind */
function collectAssets(
  incoming: readonly PluginAsset[],
  assets: Map<PluginAssetKind, PluginAsset[]>,
  enabled: readonly PluginAssetKind[],
  localKinds: ReadonlySet<PluginAssetKind>
): void {
  for (const asset of incoming) {
    if (!enabled.includes(asset.kind)) continue
    if (localKinds.has(asset.kind)) continue
    if (SINGLE_KINDS.has(asset.kind)) {
      if ((assets.get(asset.kind)?.length ?? 0) > 0) continue
    }
    const bucket = assets.get(asset.kind) ?? []
    bucket.push(asset)
    assets.set(asset.kind, bucket)
  }
}

/**
 * 按顺序调用插件，尽可能补齐详情与资源。
 *
 * `pick` 是候选挑选器：影片按番号 + 标题（默认），剧集没有番号，传 `pickSeriesCandidate`。
 */
export async function collectFromPlugins(
  context: ScrapeJobContext,
  enabled: readonly PluginAssetKind[],
  localKinds: ReadonlySet<PluginAssetKind>,
  pick: (
    candidates: readonly PluginMovieCandidate[]
  ) => PluginMovieCandidate | null = (candidates) =>
    pickCandidate(candidates, context.entry.num, context.entry.keyword)
): Promise<{
  detail: PluginMovieDetail | null
  pluginId: string
  assets: Map<PluginAssetKind, PluginAsset[]>
}> {
  const assets = new Map<PluginAssetKind, PluginAsset[]>()
  let detail: PluginMovieDetail | null = null
  let pluginId = ''

  const missing = (kind: PluginAssetKind): boolean =>
    enabled.includes(kind) && !localKinds.has(kind) && (assets.get(kind)?.length ?? 0) === 0

  for (const plugin of context.plugins) {
    if (context.signal.aborted) throw new ScrapeError('cancelled')
    try {
      if (!detail) {
        const candidates = readCandidates(
          await moviePlugins.invokePlugin(plugin.id, 'search', { keyword: context.entry.keyword })
        )
        const picked = pick(candidates)
        if (picked) {
          const found = readDetail(
            await moviePlugins.invokePlugin(plugin.id, 'detail', { movieId: picked.id })
          )
          if (found) {
            detail = found
            pluginId = plugin.id
          }
        }
      }
      if (detail) {
        const movieId = detail.id
        if (COVER_ASSET_KINDS.some(missing)) {
          collectAssets(
            readAssets(await moviePlugins.invokePlugin(plugin.id, 'covers', { movieId })),
            assets,
            enabled,
            localKinds
          )
        }
        if (EXTRA_ASSET_KINDS.some(missing)) {
          collectAssets(
            readAssets(await moviePlugins.invokePlugin(plugin.id, 'extras', { movieId })),
            assets,
            enabled,
            localKinds
          )
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      context.log.warn(`插件 ${plugin.name} 处理失败，继续尝试后续插件：${message}`)
    }
    if (isSatisfied(detail, assets, enabled, localKinds)) break
  }

  return { detail, pluginId, assets }
}

/** 确保目标文件的父目录存在 */
export async function ensureParent(context: ScrapeJobContext, target: string): Promise<void> {
  const folder = dirnameRemotePath(target)
  if (folder === FILE_ROOT) return
  await context.client.mkdir(folder, { recursive: true })
}

/** 下载一条资源并上传到目标路径；失败抛错由调用方记警告 */
export async function downloadAsset(
  context: ScrapeJobContext,
  target: string,
  asset: PluginAsset
): Promise<void> {
  const download = await downloadAssetToTemp(asset, context.signal)
  try {
    await context.client.upload(download.localPath, target, {
      overwrite: true,
      signal: context.signal
    })
  } finally {
    await download.cleanup()
  }
}

/**
 * 把一张本地图片搬到规范文件名下（`localFirst`）。
 *
 * 规范名已经存在时保留磁盘上那份，本地图片原样不动；搬运失败时仍按原路径入库，
 * 至少不会丢掉这张图。真的搬动了才记 `origin`：NFO 里的还原记录靠它把这张图搬回原名。
 */
export async function adoptLocalImage(
  context: ScrapeJobContext,
  image: LocalImage,
  index: number,
  movieDir: string,
  assetContext: ScrapeAssetContext
): Promise<PlantedAsset> {
  const { client } = context
  const plan = resolveAssetName(image.kind, image.name, index, assetContext)
  const target = joinRemotePath(movieDir, plan.relativePath)
  const imageType = IMAGE_KIND_TYPE[image.kind]
  if (image.path !== target) {
    let origin: string | undefined
    try {
      if (await client.exists(target)) {
        context.log.info(`规范文件名已存在，沿用磁盘上的文件：${target}`)
      } else {
        await ensureParent(context, target)
        await client.move(image.path, target, { overwrite: false })
        origin = image.path
        context.log.info(`本地图片就位：${image.name} → ${plan.relativePath}`)
      }
      return { kind: image.kind, relativePath: plan.relativePath, path: target, imageType, origin }
    } catch (error) {
      if (context.signal.aborted) throw new ScrapeError('cancelled')
      const message = error instanceof Error ? error.message : '未知错误'
      context.log.warn(`本地图片整理失败（${image.path}）：${message}`)
    }
  }
  return { kind: image.kind, relativePath: plan.relativePath, path: image.path, imageType }
}

/** 就位的图片 → NFO 里的图片标签值（都是相对影片目录的路径） */
export function artworkOf(planted: readonly PlantedAsset[]): NfoArtwork {
  const artwork: NfoArtwork = {}
  const stills: string[] = []
  for (const item of planted) {
    if (item.kind === 'poster') artwork.poster ??= item.relativePath
    else if (item.kind === 'thumb') artwork.thumb ??= item.relativePath
    else if (item.kind === 'fanart') artwork.backdrop ??= item.relativePath
    else if (item.kind === 'banner') artwork.banner ??= item.relativePath
    else if (item.kind === 'logo') artwork.logo ??= item.relativePath
    else if (item.kind === 'still') stills.push(item.relativePath)
  }
  if (stills.length > 0) artwork.stills = stills
  return artwork
}
