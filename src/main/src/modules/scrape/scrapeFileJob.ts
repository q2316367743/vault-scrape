/**
 * 单文件刮削流水线：一个视频文件 → 一个 Jellyfin 目录规范的影片文件夹。
 *
 * 契约（严格按需求里的顺序与不变量）：
 * 1. **插件按顺序调用**，每个插件都走 `search → detail`；命中详情后只补它缺的资源，
 *    关键信息与启用资源齐全就**提前停止**，不再调用后面的插件（跨插件补全）；
 * 2. **一定整理成影片文件夹**：`<根目录>/<base>/<base><ext>`；`base` 是命名模板的渲染结果
 *    （强制改名，没有开关），**文件夹名 / 视频文件名 / NFO 文件名三处同值**；
 *    移动开关只决定根目录是原目录还是资料库的移动目标目录；
 * 3. **一定写 NFO**：`<base>.nfo`，带图片标签；图片与影片同目录
 *    （`poster.jpg` / `backdrop.jpg` / `thumb.jpg` / `banner.jpg` / `logo.png` /
 *    `extrafanart/fanartN.jpg`），没有「写到别处」这个选项；
 * 4. 下载哪些资源由 `download` 的开关决定；`keepXxx` 为真且目标已存在时跳过；
 *    `banner` / `logo` 没有独立开关，已有同名文件就不覆盖；
 * 5. `localFirst` 为真时先读本地 NFO 与本地图片：本地已有的字段与图片不再上网，
 *    只补缺失项，被采用的本地图片会被搬到规范文件名下，旧的本地 NFO 在写入新 NFO 后删掉；
 * 6. 成功后把元数据写回 `media_item`、图片写进 `media_image`；文件被移动时就地更新
 *    `media_source`（**保持 source id 不变**，墙面与协议地址都不受影响）；
 *    `file.removeEmptyFolder` 为真且源目录空了就删掉它（绝不删资料库目录）；
 * 7. 单文件失败只产出结果行，不抛给任务；取消通过 `signal` 打断。
 */
import {
  FILE_ROOT,
  basenameRemotePath,
  dirnameRemotePath,
  extnameOf,
  guessMimeType,
  joinRemotePath
} from '@common/types/file'
import type { MediaImageType } from '@common/types/media'
import type { PluginAsset, PluginAssetKind, PluginMovieDetail } from '@common/types/plugin'
import { COVER_ASSET_KINDS, EXTRA_ASSET_KINDS } from '@common/types/plugin'
import {
  ScrapeError,
  buildNfoXml,
  enabledAssetKinds,
  extractKeyword,
  keepFlagOf,
  normalizePartToken,
  partTokenOf,
  renderTemplate,
  resolveAssetName,
  resolveAssetFile,
  sanitizeName,
  truncateName,
  type NfoArtwork,
  type ScrapeAssetContext,
  type ScrapeFileStatus
} from '@common/types/scrape'
import type {
  SettingDownload,
  SettingFile,
  SettingNaming,
  SettingScrape
} from '@common/types/setting'
import { replaceItemImages, type MediaImageDraft } from '$/db/repo/mediaImageRepo'
import {
  findSourceByPath,
  getItem,
  readItemMetadata,
  updateItem,
  updateItemMetadata,
  updateSourcePath,
  type MediaItemMetadataInput
} from '$/db/repo/mediaRepo'
import type { FileClient } from '$/modules/file/FileClient'
import { invokePlugin } from '$/modules/plugin/pluginRegistry'
import { downloadAssetToTemp } from './scrapeAssets'
import { movieDirOf, movieFileName, nfoFileName, resolveOutputDir } from './scrapeLayout'
import { mergeDetail, needsRemoteInfo, readLocalMeta, type LocalImage } from './scrapeLocalMeta'
import type { ScrapeRunLog } from './scrapeLogFile'
import { pickCandidate } from './scrapeMatcher'
import { readAssets, readCandidates, readDetail } from './scrapePluginData'

/** 参与刮削的插件（顺序即插件页顺序） */
export interface ScrapePluginRef {
  id: string
  name: string
}

/** 任务启动时冻结的设置快照：任务运行期间改设置不影响已启动的任务 */
export interface ScrapeSettingsSnapshot {
  scrape: SettingScrape
  download: SettingDownload
  naming: SettingNaming
  file: SettingFile
}

/**
 * 任务启动时冻结的资料库策略。
 *
 * 刮削产物的形态是全库统一的固定规范（文件夹 + 同名视频 + NFO + 同目录图片），
 * 所以这里只有「移动到哪里」和「是否优先本地」两个变量。
 */
export interface ScrapeLibraryPolicy {
  libraryId: string
  /** 优先读取本地 NFO 与本地图片，只从互联网补缺失的信息 */
  localFirst: boolean
  moveEnabled: boolean
  moveDirectory: string
  /** 资料库的媒体目录（连接内绝对路径）：清理空目录时绝不删它们 */
  libraryRoots: readonly string[]
}

export interface ScrapeJobContext {
  taskId: string
  connectionId: string
  policy: ScrapeLibraryPolicy
  dirPath: string
  entry: {
    /** 媒体条目 ID：元数据与图片写回的目标 */
    itemId: string
    path: string
    name: string
    keyword: string
    num: string
  }
  plugins: readonly ScrapePluginRef[]
  settings: ScrapeSettingsSnapshot
  client: FileClient
  signal: AbortSignal
  log: ScrapeRunLog
}

export interface ScrapeJobOutcome {
  status: ScrapeFileStatus
  pluginId: string
  title: string
  message: string
  /**
   * 本次结束时文件在连接内的最终路径。
   *
   * 未发生移动时就是扫描时的原路径；媒体源靠它就地更新。
   */
  finalPath: string
}

/** 插件资源 / 本地图片 → 媒体图片类型；不在表里的（预告片）只落盘不入库 */
const IMAGE_KIND_TYPE: Partial<Record<PluginAssetKind, MediaImageType>> = {
  poster: 'primary',
  thumb: 'thumb',
  fanart: 'backdrop',
  banner: 'banner',
  logo: 'logo',
  still: 'still'
}

/** 只保留一份的图片 kind：多版本会导致文件名互相覆盖 */
const SINGLE_KINDS: ReadonlySet<PluginAssetKind> = new Set([
  'poster',
  'thumb',
  'fanart',
  'banner',
  'logo'
])

/** 已经就位的资源（本地沿用的与刚下载的共用一套记录） */
interface PlantedAsset {
  kind: PluginAssetKind
  /** 相对影片目录的路径 */
  relativePath: string
  /** 连接内绝对路径 */
  path: string
  imageType?: MediaImageType
}

/** 去掉扩展名 */
function baseNameOf(name: string): string {
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(0, index) : name
}

/** 扩展名（含点），没有扩展名时为空串 */
function extensionOf(name: string): string {
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(index) : ''
}

/**
 * 按命名规则算出影片基础名（文件夹名 / 视频文件名 / NFO 文件名三处共用）。
 *
 * 模板渲染为空时回落原名；分盘标记（CD1 / PART2…）始终按 `partStyle` 附在末尾，
 * 否则同名模板会让同一部作品的分盘文件互相覆盖。
 */
function resolveVideoBase(
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

/** 按顺序调用插件，尽可能补齐详情与资源 */
async function collectFromPlugins(
  context: ScrapeJobContext,
  enabled: readonly PluginAssetKind[],
  localKinds: ReadonlySet<PluginAssetKind>
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
          await invokePlugin(plugin.id, 'search', { keyword: context.entry.keyword })
        )
        const picked = pickCandidate(candidates, context.entry.num, context.entry.keyword)
        if (picked) {
          const found = readDetail(await invokePlugin(plugin.id, 'detail', { movieId: picked.id }))
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
            readAssets(await invokePlugin(plugin.id, 'covers', { movieId })),
            assets,
            enabled,
            localKinds
          )
        }
        if (EXTRA_ASSET_KINDS.some(missing)) {
          collectAssets(
            readAssets(await invokePlugin(plugin.id, 'extras', { movieId })),
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
async function ensureParent(context: ScrapeJobContext, target: string): Promise<void> {
  const folder = dirnameRemotePath(target)
  if (folder === FILE_ROOT) return
  await context.client.mkdir(folder, { recursive: true })
}

/** 下载一条资源并上传到目标路径；失败抛错由调用方记警告 */
async function downloadAsset(
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
 * 至少不会丢掉这张图。
 */
async function adoptLocalImage(
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
    try {
      if (await client.exists(target)) {
        context.log.info(`规范文件名已存在，沿用磁盘上的文件：${target}`)
      } else {
        await ensureParent(context, target)
        await client.move(image.path, target, { overwrite: false })
        context.log.info(`本地图片就位：${image.name} → ${plan.relativePath}`)
      }
      return { kind: image.kind, relativePath: plan.relativePath, path: target, imageType }
    } catch (error) {
      if (context.signal.aborted) throw new ScrapeError('cancelled')
      const message = error instanceof Error ? error.message : '未知错误'
      context.log.warn(`本地图片整理失败（${image.path}）：${message}`)
    }
  }
  return { kind: image.kind, relativePath: plan.relativePath, path: image.path, imageType }
}

/** 就位的图片 → NFO 里的图片标签值（都是相对影片目录的路径） */
function artworkOf(planted: readonly PlantedAsset[]): NfoArtwork {
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

/** 上次刮削写下的 ID 信息：本地优先跳过联网时要沿用，不能清空 */
function previousMetadataOf(
  itemId: string
): { providerIds: Record<string, string>; scraperId: string } | null {
  if (itemId.length === 0) return null
  const row = getItem(itemId)
  if (!row) return null
  return { providerIds: readItemMetadata(row).providerIds, scraperId: row.scraperId }
}

/** 插件详情 → 条目元数据列；插件没有的字段一律写空，避免沿用上一次的旧值 */
function metadataOf(
  detail: PluginMovieDetail,
  fallbackNum: string,
  pluginId: string,
  itemId: string
): MediaItemMetadataInput {
  const previous = pluginId.length > 0 ? null : previousMetadataOf(itemId)
  const releaseDate = detail.releaseDate ?? ''
  const year = Number.parseInt(releaseDate.slice(0, 4), 10)
  return {
    title: detail.title,
    num: detail.num ?? fallbackNum,
    originalTitle: detail.originalTitle ?? '',
    overview: detail.plot ?? '',
    tagline: '',
    premiereDate: releaseDate,
    productionYear: Number.isFinite(year) ? year : 0,
    runtimeMinutes: detail.duration ?? 0,
    officialRating: '',
    communityRating: 0,
    genres: [],
    studios: detail.studio ? [detail.studio] : detail.maker ? [detail.maker] : [],
    tags: detail.tags ?? [],
    providerIds: pluginId.length > 0 ? { [pluginId]: detail.id } : (previous?.providerIds ?? {}),
    scraperId: pluginId.length > 0 ? pluginId : (previous?.scraperId ?? ''),
    scrapedAt: Date.now()
  }
}

/**
 * 文件被移动后就地更新媒体源与条目路径（两者的 id 都不变）。
 *
 * 条目路径必须跟着走：媒体身份按 (connectionId, path) 解析，若只改媒体源、
 * 条目还留着旧路径，下次扫描会按新路径认成全新条目，`cleanupUnseen` 随即把
 * 刚刮好的条目连同图片一起删掉。读不到详情时至少把路径改对。
 */
async function refreshSourcePath(context: ScrapeJobContext, targetPath: string): Promise<void> {
  const source = findSourceByPath(context.connectionId, context.entry.path)
  updateItem(context.entry.itemId, { path: targetPath })
  if (!source) return
  const name = basenameRemotePath(targetPath)
  try {
    const info = await context.client.stat(targetPath)
    updateSourcePath(source.id, {
      path: targetPath,
      name: info.name,
      extname: info.extname,
      mime: info.mime.length > 0 ? info.mime : guessMimeType(info.name),
      size: info.size,
      modifiedAt: info.modifiedAt
    })
  } catch {
    updateSourcePath(source.id, {
      path: targetPath,
      name,
      extname: extnameOf(name),
      mime: guessMimeType(name),
      size: source.size,
      modifiedAt: source.modifiedAt
    })
  }
}

/** 移走视频后删掉腾空的源目录（只删源目录本身，且绝不删资料库目录） */
async function removeSourceFolderIfEmpty(
  context: ScrapeJobContext,
  movieDir: string
): Promise<void> {
  const { client, settings, policy, dirPath } = context
  if (!settings.file.removeEmptyFolder) return
  if (dirPath === movieDir || dirPath === FILE_ROOT) return
  if (policy.libraryRoots.includes(dirPath)) return
  try {
    const rest = await client.list(dirPath)
    if (rest.length > 0) return
    await client.remove(dirPath, { recursive: true })
    context.log.info(`已删除空目录：${dirPath}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    context.log.warn(`空目录清理失败（${dirPath}）：${message}`)
  }
}

/** 执行单个文件的完整流水线 */
export async function runFileJob(context: ScrapeJobContext): Promise<ScrapeJobOutcome> {
  const { entry, settings, client, policy } = context
  const enabled = enabledAssetKinds(settings.download)
  const originalBase = baseNameOf(entry.name)
  const extension = extensionOf(entry.name)

  // 1. 本地优先：先看本地 NFO 与本地图片，本地有的东西不再上网
  const local = policy.localFirst
    ? await readLocalMeta(client, {
        dirPath: context.dirPath,
        originalBase,
        fanartDirName: settings.scrape.fanartDirName
      })
    : null
  const localKinds = new Set<PluginAssetKind>(local?.assets.keys() ?? [])
  const needRemote =
    !local?.detail ||
    enabled.some((kind) => !localKinds.has(kind)) ||
    (local.nfo !== null && needsRemoteInfo(local.nfo.meta))

  let detail: PluginMovieDetail | null = local?.detail ?? null
  let pluginId = ''
  let assets = new Map<PluginAssetKind, PluginAsset[]>()
  if (needRemote) {
    const collected = await collectFromPlugins(context, enabled, localKinds)
    pluginId = collected.pluginId
    assets = collected.assets
    detail = detail ? mergeDetail(detail, collected.detail) : collected.detail
  }
  if (!detail) {
    return {
      status: 'failed',
      pluginId: '',
      title: '',
      message: '未找到匹配的刮削结果',
      finalPath: entry.path
    }
  }

  // 2. 目录规范：文件夹名 / 视频文件名 / NFO 文件名三处同值
  const base = resolveVideoBase(detail, originalBase, settings.naming)
  // 原地整理时若当前目录已经叫 base（上次刮削的成果），rootDir 取它的上一层，
  // 否则会套娃成 `<base>/<base>/`；移动模式下 rootDir 由移动目录决定，不受影响
  const alreadyOrganized = basenameRemotePath(context.dirPath) === base
  const rootDir = policy.moveEnabled
    ? resolveOutputDir(policy.moveDirectory, context.dirPath)
    : alreadyOrganized
      ? dirnameRemotePath(context.dirPath)
      : context.dirPath
  const movieDir = movieDirOf(rootDir, base)
  if (movieDir !== context.dirPath) await client.mkdir(movieDir, { recursive: true })
  const assetContext: ScrapeAssetContext = {
    videoBase: base,
    naming: settings.naming,
    fanartDirName: settings.scrape.fanartDirName
  }

  const planted: PlantedAsset[] = []
  let assetFailures = 0

  // 3. 本地图片就位（搬到规范文件名下）
  if (local) {
    for (const [kind, images] of local.assets) {
      const wanted = SINGLE_KINDS.has(kind) ? images.slice(0, 1) : images
      for (let index = 0; index < wanted.length; index += 1) {
        const image = wanted[index]
        if (!image) continue
        try {
          planted.push(await adoptLocalImage(context, image, index + 1, movieDir, assetContext))
        } catch (error) {
          if (context.signal.aborted) throw new ScrapeError('cancelled')
          assetFailures += 1
          const message = error instanceof Error ? error.message : '未知错误'
          context.log.warn(`本地图片整理失败（${image.path}）：${message}`)
        }
      }
    }
  }

  // 4. 缺的资源联网下载；本地已经有的 kind 一律不动
  const plantedKinds = new Set(planted.map((item) => item.kind))
  for (const kind of enabled) {
    if (plantedKinds.has(kind)) continue
    const bucket = assets.get(kind) ?? []
    for (let index = 0; index < bucket.length; index += 1) {
      const asset = bucket[index]
      if (!asset) continue
      const plan = resolveAssetFile(asset, index + 1, assetContext)
      const target = joinRemotePath(movieDir, plan.relativePath)
      try {
        if (keepFlagOf(settings.download, kind) && (await client.exists(target))) {
          context.log.info(`目标已存在，按保留设置跳过：${target}`)
        } else {
          await ensureParent(context, target)
          await downloadAsset(context, target, asset)
          context.log.info(`资源已写入：${plan.relativePath}`)
        }
        planted.push({
          kind,
          relativePath: plan.relativePath,
          path: target,
          imageType: IMAGE_KIND_TYPE[kind]
        })
      } catch (error) {
        if (context.signal.aborted) throw new ScrapeError('cancelled')
        assetFailures += 1
        const message = error instanceof Error ? error.message : '未知错误'
        context.log.warn(`资源写入失败（${plan.relativePath}）：${message}`)
      }
    }
  }

  // 5. 一定写 NFO（与影片同名，带图片标签）
  const nfoTarget = joinRemotePath(movieDir, nfoFileName(base))
  let nfoWritten = false
  try {
    await client.writeText(nfoTarget, buildNfoXml(detail, settings.naming, artworkOf(planted)), {
      overwrite: true
    })
    nfoWritten = true
  } catch (error) {
    if (context.signal.aborted) throw new ScrapeError('cancelled')
    const message = error instanceof Error ? error.message : '未知错误'
    context.log.warn(`NFO 写入失败：${message}`)
  }

  // 本地 NFO 已经读进新 NFO，旧的留着只会造成两份不一致
  if (nfoWritten && local?.nfo && local.nfo.path !== nfoTarget) {
    try {
      await client.remove(local.nfo.path)
      context.log.info(`已移除旧的本地 NFO：${local.nfo.path}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      context.log.warn(`旧本地 NFO 移除失败（${local.nfo.path}）：${message}`)
    }
  }

  // 6. 视频落到影片文件夹里（文件名与文件夹名一致）
  const targetPath = joinRemotePath(movieDir, movieFileName(base, extension))
  if (targetPath !== entry.path) {
    try {
      await client.move(entry.path, targetPath, { overwrite: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      throw new ScrapeError('moveFailed', `移动文件失败：${message}`)
    }
    await refreshSourcePath(context, targetPath)
    await removeSourceFolderIfEmpty(context, movieDir)
  }

  // 7. 元数据与图片写回媒体库：图片就在影片目录里，墙面替换后立即用新图
  const images: MediaImageDraft[] = planted
    .filter((item) => item.imageType !== undefined)
    .map((item) => ({
      libraryId: policy.libraryId,
      type: item.imageType as MediaImageType,
      connectionId: context.connectionId,
      path: item.path,
      width: 0,
      height: 0
    }))
  updateItemMetadata(entry.itemId, metadataOf(detail, entry.num, pluginId, entry.itemId))
  replaceItemImages(entry.itemId, images)

  const parts = [pluginId.length > 0 ? `插件 ${pluginId}` : '本地 NFO', `${planted.length} 个资源`]
  if (nfoWritten) parts.push(`NFO ${nfoFileName(base)}`)
  if (assetFailures > 0) parts.push(`${assetFailures} 个资源失败`)
  if (targetPath !== entry.path) parts.push(`→ ${targetPath}`)

  return {
    status: 'success',
    pluginId,
    title: detail.title,
    message: parts.join('，'),
    finalPath: targetPath
  }
}

/** 判断文件是否已在之前的运行里完成（用于「继续」时跳过） */
export function isFinishedStatus(status: ScrapeFileStatus): boolean {
  return status === 'success' || status === 'skipped'
}

/** 文件名解析出的关键词（运行器组装任务行时复用） */
export function keywordOf(name: string): { keyword: string; num: string } {
  const parsed = extractKeyword(name)
  return { keyword: parsed.cleaned, num: parsed.num }
}
