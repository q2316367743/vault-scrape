/**
 * 刮削单文件流水线的「写回」步骤：条目元数据映射、媒体源路径刷新、空目录清理。
 *
 * 契约：路径与元数据写回都在这里，`scrapeFileJob` 只负责按顺序调用。
 */
import {
  FILE_ROOT,
  basenameRemotePath,
  extnameOf,
  guessMimeType,
  joinRemotePath
} from '@common/types/file'
import type { FileClient } from '$/modules/file/FileClient'
import type { PluginMovieDetail } from '@common/types/plugin'
import {
  findSourceByPath,
  getItem,
  listSourcesByItem,
  readItemMetadata,
  updateItem,
  updateSourcePath,
  type MediaItemMetadataInput
} from '$/db/repo/mediaRepo'
import { parseNfoRestore } from '@common/types/media'
import type { NfoRestoreFile, NfoRestoreInfo } from '@common/types/media'
import { providerKeyOf } from '@common/types/scrape'
import type { PlantedAsset } from './scrapeJobPlan'
import type { ScrapeJobContext } from './scrapeJobTypes'

/**
 * 对齐「上一次的还原记录」与「这一次就位的资源」。
 *
 * 只记**这次真的写下或搬过的**文件：联网下载的（`created`）没有原位置、还原时直接删；
 * 本地沿用并改了名的（`origin`）还原时搬回去；沿用磁盘上已有文件（保留设置跳过）与
 * 没挪过位置的本地图片都不记，免得清除时删掉用户自己的文件。
 * 这一次重新就位的资源一律用这一次的路径；上一次记录里本地沿用的图片如果这次没被重新
 * 就位、原文件又还在，就接着沿用，免得第二次刮削把第一次留下的还原信息弄丢。
 */
export async function mergeRestoreFiles(
  carried: readonly NfoRestoreFile[],
  planted: readonly PlantedAsset[],
  context: ScrapeJobContext
): Promise<NfoRestoreFile[]> {
  const files: NfoRestoreFile[] = planted
    .filter((item) => item.origin !== undefined || item.created === true)
    .map((item) => ({ relativePath: item.relativePath, origin: item.origin ?? '' }))
  const landed = new Set(files.map((file) => file.relativePath))
  for (const file of carried) {
    if (landed.has(file.relativePath) || file.origin.length === 0) continue
    try {
      if (await context.client.exists(file.origin)) files.push(file)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      context.log.warn(`还原记录沿用失败（${file.relativePath}）：${message}`)
    }
  }
  return files
}

/**
 * 读磁盘上已有的 NFO，沿用它的还原记录。
 *
 * 第二次刮削时若把「当前路径」当成原始位置，清除 NFO 就再也搬不回用户原来的文件名与目录，
 * 所以只要旧 NFO 还在，就继续用它的记录；读不到就用 `fallback`。
 */
export async function carryRestore(
  context: ScrapeJobContext,
  nfoPath: string,
  fallback: NfoRestoreInfo
): Promise<NfoRestoreInfo> {
  try {
    if (!(await context.client.exists(nfoPath))) return fallback
    return parseNfoRestore(await context.client.readText(nfoPath)) ?? fallback
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    context.log.warn(`旧 NFO 读取失败（${nfoPath}）：${message}`)
    return fallback
  }
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
export function metadataOf(
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
    genres: detail.genres ?? [],
    studios: detail.studio ? [detail.studio] : detail.maker ? [detail.maker] : [],
    tags: detail.tags ?? [],
    maker: detail.maker ?? '',
    label: detail.label ?? '',
    series: detail.series ?? '',
    director: detail.director ?? '',
    // provider 名统一走 providerKeyOf：文件名里的 `[r18id-xxx]` 与 NFO 的
    // `<uniqueid type="r18">` 是同一套键，扫描读回来才对得上
    providerIds:
      pluginId.length > 0 ? { [providerKeyOf(pluginId)]: detail.id } : (previous?.providerIds ?? {}),
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
 *
 * 入参显式给出（不吃 `ScrapeJobContext`）：刮削与「清除 NFO」的还原都要用这套口径。
 */
export async function refreshSourcePath(
  client: FileClient,
  connectionId: string,
  itemId: string,
  fromPath: string,
  toPath: string
): Promise<void> {
  updateItem(itemId, { path: toPath })
  await refreshSourceLocation(client, connectionId, fromPath, toPath)
}

/**
 * 目录型条目整体换位置（整个影片目录改名 / 搬走）：条目路径与它下面**所有**媒体源一起改写。
 *
 * 与 `refreshSourcePath` 的区别是条目路径只写一次、视频文件本身没动（只是父目录变了），
 * 所以这里**不能**把条目路径写成某个视频的路径，否则目录型条目会退化成单文件条目。
 */
export async function refreshItemDir(
  client: FileClient,
  connectionId: string,
  itemId: string,
  toDir: string
): Promise<void> {
  updateItem(itemId, { path: toDir })
  for (const source of listSourcesByItem(itemId)) {
    const nextPath = joinRemotePath(toDir, basenameRemotePath(source.path))
    if (nextPath === source.path) continue
    await refreshSourceLocation(client, connectionId, source.path, nextPath)
  }
}

/** 只把媒体源的路径与体积 / 时间刷到新位置（不动条目路径） */
async function refreshSourceLocation(
  client: FileClient,
  connectionId: string,
  fromPath: string,
  toPath: string
): Promise<void> {
  const source = findSourceByPath(connectionId, fromPath)
  if (!source) return
  const name = basenameRemotePath(toPath)
  try {
    const info = await client.stat(toPath)
    updateSourcePath(source.id, {
      path: toPath,
      name: info.name,
      extname: info.extname,
      mime: info.mime.length > 0 ? info.mime : guessMimeType(info.name),
      size: info.size,
      modifiedAt: info.modifiedAt
    })
  } catch {
    updateSourcePath(source.id, {
      path: toPath,
      name,
      extname: extnameOf(name),
      mime: guessMimeType(name),
      size: source.size,
      modifiedAt: source.modifiedAt
    })
  }
}

/** 移走视频后删掉腾空的源目录（只删源目录本身，且绝不删资料库目录） */
export async function removeSourceFolderIfEmpty(
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
