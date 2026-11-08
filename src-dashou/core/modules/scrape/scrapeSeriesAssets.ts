/**
 * 剧集刮削的资源落盘与旧目录清理（从 `scrapeSeriesJob` 抽出的纯 IO 辅助）。
 *
 * 契约：
 * - 单个资源失败不影响整个剧集：只累计失败条数并记警告；
 * - `SINGLE_KINDS`（海报 / 缩略图等固定名资源）只取第一张，避免同目录互相覆盖；
 * - 打开「保留已有」时目标已存在就跳过下载，但仍计入已就位资源（媒体库图片行照写）；
 * - 用户取消时立刻抛 `cancelled`，其它异常一律降级为警告。
 */
import { joinRemotePath } from '@common/types/file'
import type { PluginAsset, PluginAssetKind, PluginEpisode, PluginMovieDetail } from '@common/types/plugin'
import { ScrapeError, keepFlagOf, resolveAssetFile, type ScrapeAssetContext } from '@common/types/scrape'
import type { MediaImageDraft } from '$/db/repo/mediaImageRepo'
import {
  IMAGE_KIND_TYPE,
  SINGLE_KINDS,
  downloadAsset,
  ensureParent,
  type PlantedAsset
} from './scrapeJobPlan'
import type { ScrapeJobContext } from './scrapeJobTypes'

/** 远端分集按「季:集」索引；插件重复给同一集时取第一个 */
export function indexRemoteEpisodes(detail: PluginMovieDetail): Map<string, PluginEpisode> {
  const result = new Map<string, PluginEpisode>()
  for (const episode of detail.episodes ?? []) {
    const key = `${episode.season ?? 1}:${episode.index}`
    if (!result.has(key)) result.set(key, episode)
  }
  return result
}

/** 资源落盘的目标目录与可选范围 */
export interface AssetLanding {
  dir: string
  context: ScrapeAssetContext
  assets: Map<PluginAssetKind, PluginAsset[]>
  kinds: readonly PluginAssetKind[]
}

/** 把一组资源落到目标目录，返回失败条数 */
export async function landAssets(
  context: ScrapeJobContext,
  landing: AssetLanding,
  into: PlantedAsset[]
): Promise<number> {
  const { client, settings } = context
  let failures = 0
  for (const kind of landing.kinds) {
    const bucket = landing.assets.get(kind) ?? []
    const wanted = SINGLE_KINDS.has(kind) ? bucket.slice(0, 1) : bucket
    for (let index = 0; index < wanted.length; index += 1) {
      const asset = wanted[index]
      if (!asset) continue
      const plan = resolveAssetFile(asset, index + 1, landing.context)
      const target = joinRemotePath(landing.dir, plan.relativePath)
      try {
        const kept = keepFlagOf(settings.download, kind) && (await client.exists(target))
        if (kept) {
          context.log.info(`目标已存在，按保留设置跳过：${target}`)
        } else {
          await ensureParent(context, target)
          await downloadAsset(context, target, asset)
          context.log.info(`资源已写入：${plan.relativePath}`)
        }
        into.push({
          kind,
          relativePath: plan.relativePath,
          path: target,
          imageType: IMAGE_KIND_TYPE[kind],
          created: !kept
        })
      } catch (error) {
        if (context.signal.aborted) throw new ScrapeError('cancelled')
        failures += 1
        const message = error instanceof Error ? error.message : '未知错误'
        context.log.warn(`资源写入失败（${plan.relativePath}）：${message}`)
      }
    }
  }
  return failures
}

/** 已就位的资源 → 媒体库图片行（尺寸交给协议层按需读取） */
export function imagesOf(planted: readonly PlantedAsset[], context: ScrapeJobContext): MediaImageDraft[] {
  const images: MediaImageDraft[] = []
  for (const item of planted) {
    const imageType = item.imageType
    if (imageType === undefined) continue
    images.push({
      libraryId: context.policy.libraryId,
      type: imageType,
      connectionId: context.connectionId,
      path: item.path,
      width: 0,
      height: 0
    })
  }
  return images
}

/** 清理搬家后空掉的旧目录：只删空目录，绝不删资料库目录与它们的祖先 */
export async function pruneEmptyDirs(context: ScrapeJobContext, dirs: readonly string[]): Promise<void> {
  const { client, settings, policy } = context
  if (!settings.file.removeEmptyFolder) return
  const keeps = policy.libraryRoots
  for (const dir of dirs) {
    if (dir.length === 0 || dir === '/' || keeps.includes(dir)) continue
    if (keeps.some((keep) => keep.startsWith(`${dir}/`))) continue
    try {
      if (!(await client.exists(dir))) continue
      if ((await client.list(dir)).length > 0) continue
      await client.remove(dir, { recursive: true })
      context.log.info(`已删除空目录：${dir}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      context.log.warn(`空目录清理失败（${dir}）：${message}`)
    }
  }
}
