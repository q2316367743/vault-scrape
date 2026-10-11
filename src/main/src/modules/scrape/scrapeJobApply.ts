/**
 * 刮削单文件流水线的「写回」步骤：条目元数据映射、媒体源路径刷新、空目录清理。
 *
 * 契约：路径与元数据写回都在这里，`scrapeFileJob` 只负责按顺序调用。
 */
import {
  FILE_ROOT,
  basenameRemotePath,
  extnameOf,
  guessMimeType
} from '@common/types/file'
import type { FileClient } from '$/modules/file/FileClient'
import type { PluginMovieDetail } from '@common/types/plugin'
import {
  findSourceByPath,
  getItem,
  readItemMetadata,
  updateItem,
  updateSourcePath,
  type MediaItemMetadataInput
} from '$/db/repo/mediaRepo'
import type { ScrapeJobContext } from './scrapeJobTypes'

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
  const source = findSourceByPath(connectionId, fromPath)
  updateItem(itemId, { path: toPath })
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
