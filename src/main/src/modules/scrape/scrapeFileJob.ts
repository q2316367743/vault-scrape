/**
 * 单文件刮削流水线：一个视频文件 → 一个 Jellyfin 目录规范的影片文件夹。
 *
 * 本文件只保留「按顺序编排」：收集与落盘在 `scrapeJobPlan.ts`，元数据与路径写回在
 * `scrapeJobApply.ts`，上下文与设置快照类型在 `scrapeJobTypes.ts`。
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
 * 7. 参演演员名单按名字写进 `media_cast`（弱关联，不记演员 ID）；`actorScrape` 为真时把资料不全的演员排进后台抓取队列，
 *    演员抓取失败只记日志，不影响本文件的刮削结果；
 * 8. 单文件失败只产出结果行，不抛给任务；取消通过 `signal` 打断。
 */
import { basenameRemotePath, dirnameRemotePath, joinRemotePath } from '@common/types/file'
import { parseNfoRestore } from '@common/types/media'
import type { MediaImageType, NfoRestoreInfo } from '@common/types/media'
import type { PluginAsset, PluginAssetKind, PluginMovieDetail } from '@common/types/plugin'
import {
  ScrapeError,
  buildNfoXml,
  enabledAssetKinds,
  extractKeyword,
  keepFlagOf,
  resolveAssetFile,
  type ScrapeAssetContext,
  type ScrapeFileStatus
} from '@common/types/scrape'
import { enqueueItemActorScrape } from '$/modules/actor/actorScrape'
import { replaceItemImages, type MediaImageDraft } from '$/db/repo/mediaImageRepo'
import { getItem, updateItemMetadata } from '$/db/repo/mediaRepo'
import {
  mergeRestoreFiles,
  metadataOf,
  refreshItemDir,
  refreshSourcePath,
  removeSourceFolderIfEmpty
} from './scrapeJobApply'
import {
  IMAGE_KIND_TYPE,
  SINGLE_KINDS,
  adoptLocalImage,
  artworkOf,
  baseNameOf,
  collectFromPlugins,
  downloadAsset,
  ensureParent,
  extensionOf,
  resolveVideoBase,
  type PlantedAsset
} from './scrapeJobPlan'
import type { ScrapeJobContext, ScrapeJobOutcome } from './scrapeJobTypes'
import { movieDirOf, movieFileName, nfoFileName, resolveOutputDir } from './scrapeLayout'
import { mergeDetail, needsRemoteInfo, readLocalMeta } from './scrapeLocalMeta'

/** 执行单个文件的完整流水线 */
export async function runFileJob(context: ScrapeJobContext): Promise<ScrapeJobOutcome> {
  const { entry, settings, client, policy } = context
  const enabled = enabledAssetKinds(settings.download)
  // 条目是「目录型」（条目路径 = 影片文件夹，视频在它里面）还是「文件型」（条目路径就是视频）。
  // 目录型占多数：Jellyfin 规范就是一个影片一个文件夹。
  const item = getItem(entry.itemId)
  const dirTyped = item !== null && item.path === context.dirPath && item.path !== entry.path
  // 目录型条目的视频文件名带着版本信息（`- 1080p` / `- dc`）或多版本共存：一律不改名，
  // 基础名取**目录名**（本地 NFO 也按目录名找），要改名就整体搬这个目录
  const originalBase = dirTyped ? basenameRemotePath(context.dirPath) : baseNameOf(entry.name)
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
  // 资料库根目录自己就是影片文件夹时（库直接指向某个影片目录 = 目录型条目）不改这一层的名字，
  // 否则会套娃成 `<影片目录>/<base>/`
  const atLibraryRoot = policy.libraryRoots.includes(context.dirPath)
  let base = resolveVideoBase(detail, originalBase, settings.naming)
  if (dirTyped && atLibraryRoot) base = originalBase
  // 原地整理时若当前目录已经叫 base（上次刮削的成果），rootDir 取它的上一层，
  // 否则会套娃成 `<base>/<base>/`；移动模式下 rootDir 由移动目录决定，不受影响。
  // 目录型条目同理：它已经在自己的文件夹里，rootDir 必须取上一层，改的就是这个文件夹的名字
  const alreadyOrganized = basenameRemotePath(context.dirPath) === base
  const rootDir = policy.moveEnabled
    ? resolveOutputDir(policy.moveDirectory, context.dirPath)
    : alreadyOrganized || dirTyped
      ? dirnameRemotePath(context.dirPath)
      : context.dirPath
  let movieDir = dirTyped && atLibraryRoot ? context.dirPath : movieDirOf(rootDir, base)
  if (dirTyped) {
    // 视频文件不动，整目录搬到规范名字下；搬不动就保持原目录，绝不改成文件型条目
    if (movieDir !== context.dirPath) {
      try {
        await client.mkdir(dirnameRemotePath(movieDir), { recursive: true })
        await client.move(context.dirPath, movieDir, { overwrite: false })
        await refreshItemDir(client, context.connectionId, entry.itemId, movieDir)
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误'
        context.log.warn(`影片目录改名失败（保持原目录）：${message}`)
        base = originalBase
        movieDir = context.dirPath
      }
    }
  } else if (movieDir !== context.dirPath) {
    await client.mkdir(movieDir, { recursive: true })
  }
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
        // 目标已存在且开着保留设置：文件是用户自己的，既不算本次写下、也不记进还原记录
        const kept = keepFlagOf(settings.download, kind) && (await client.exists(target))
        if (kept) {
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
          imageType: IMAGE_KIND_TYPE[kind],
          created: !kept
        })
      } catch (error) {
        if (context.signal.aborted) throw new ScrapeError('cancelled')
        assetFailures += 1
        const message = error instanceof Error ? error.message : '未知错误'
        context.log.warn(`资源写入失败（${plan.relativePath}）：${message}`)
      }
    }
  }

  // 5. 一定写 NFO（与影片同名，带图片标签与「刮削前位置」还原记录）
  // 已经带着还原记录的 NFO（旧版本刮削过、或本地自带）接着沿用，否则用本次的原始位置
  const carried = local?.nfo ? parseNfoRestore(local.nfo.xml) : null
  const record = carried ?? { fileName: entry.name, directory: context.dirPath, files: [] }
  const restore: NfoRestoreInfo = {
    fileName: record.fileName,
    directory: record.directory,
    files: await mergeRestoreFiles(record.files, planted, context)
  }
  const nfoTarget = joinRemotePath(movieDir, nfoFileName(base))
  let nfoWritten = false
  try {
    await client.writeText(
      nfoTarget,
      buildNfoXml(detail, settings.naming, artworkOf(planted), restore),
      { overwrite: true }
    )
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
  // 目录型条目不碰视频文件名：多版本靠 `- 1080p` 之类的后缀区分，改名会毁掉版本信息，
  // 而且同一个文件夹里的多个版本都属于这一个条目，改名只会把其中一个挑出来
  const targetPath = dirTyped
    ? joinRemotePath(movieDir, basenameRemotePath(entry.path))
    : joinRemotePath(movieDir, movieFileName(base, extension))
  if (!dirTyped && targetPath !== entry.path) {
    try {
      await client.move(entry.path, targetPath, { overwrite: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      throw new ScrapeError('moveFailed', `移动文件失败：${message}`)
    }
    await refreshSourcePath(client, context.connectionId, entry.itemId, entry.path, targetPath)
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

  // 8. 演员：把参演名单按名字写进 media_cast；开了自动补全就把资料不全的演员排进后台队列
  try {
    const queued = enqueueItemActorScrape(
      entry.itemId,
      detail.actors ?? [],
      context.settings.scrape.actorScrape,
      context.signal
    )
    if (queued > 0) context.log.info(`已把 ${queued} 位演员排进资料抓取队列`)
  } catch (error) {
    const reason = error instanceof Error ? error.message : '未知错误'
    context.log.warn(`演员信息写入失败：${reason}`)
  }

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
