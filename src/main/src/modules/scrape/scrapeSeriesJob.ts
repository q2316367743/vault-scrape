/**
 * 剧集刮削流水线：一个「剧集目录」→ 规范剧集目录 + `Season NN` + `S01E01` 命名 + NFO / 图片。
 *
 * 与影片（`scrapeFileJob`）的差别：
 * - 搜索关键词来自**剧集目录名或剧集名**（剧集没有番号），候选匹配用 `pickSeriesCandidate`；
 * - 一次任务处理整个剧集：剧集条目、季条目、每个集条目都要更新；
 * - 剧集目录整树改名时先移动目录、再用 `replacePathPrefix` 一次改写三类路径
 *   （条目 / 媒体源 / 图片，**id 与 parentId 都不变**）；目录动不了就退回逐个集文件移动；
 * - 产物：`<剧集目录>/tvshow.nfo` + poster / backdrop / thumb / banner / logo、
 *   `<季目录>/season.nfo` + `poster.jpg`、`<季目录>/<集基础名>.nfo` + `<集基础名>-thumb.jpg`；
 * - 集 NFO 与剧集 NFO 各自带还原记录：清除 NFO 时把集文件搬回原来的目录与文件名。
 *
 * 已知限制（同步在 docs/media/01-media-library.md）：剧集库暂不支持「本地优先」，一律联网刮削。
 */
import { basenameRemotePath, dirnameRemotePath, joinRemotePath } from '@common/types/file'
import type { NfoRestoreInfo } from '@common/types/media'
import {
  ScrapeError,
  assetExtension,
  buildEpisodeNfoXml,
  buildSeasonNfoXml,
  buildTvShowNfoXml,
  enabledAssetKinds,
  keepFlagOf,
  renderEpisodeTemplate,
  renderSeasonFolderName,
  renderTemplate,
  seriesYearOf,
  type ScrapeAssetContext
} from '@common/types/scrape'
import { enqueueItemActorScrape } from '$/modules/actor/actorScrape'
import { seasonItemId } from '$/modules/media/mediaSeriesIndexer'
import { replaceItemImages } from '$/db/repo/mediaImageRepo'
import { insertItem, updateItem, updateItemMetadata } from '$/db/repo/mediaRepo'
import {
  listSeasonItems,
  listSeriesEpisodes,
  replacePathPrefix,
  type SeriesEpisodeFile
} from '$/db/repo/mediaSeriesRepo'
import { carryRestore, mergeRestoreFiles, metadataOf, refreshSourcePath } from './scrapeJobApply'
import {
  IMAGE_KIND_TYPE,
  artworkOf,
  baseNameOf,
  collectFromPlugins,
  downloadAsset,
  ensureParent,
  extensionOf,
  type PlantedAsset
} from './scrapeJobPlan'
import { pickSeriesCandidate } from './scrapeMatcher'
import { imagesOf, indexRemoteEpisodes, landAssets, pruneEmptyDirs } from './scrapeSeriesAssets'
import type { ScrapeJobContext, ScrapeJobOutcome } from './scrapeJobTypes'
import { movieFileName, nfoFileName, resolveOutputDir } from './scrapeLayout'

const SERIES_NFO_NAME = 'tvshow.nfo'
const SEASON_NFO_NAME = 'season.nfo'
const EPISODE_THUMB_SUFFIX = '-thumb'

/** 执行整个剧集的完整流水线 */
export async function runSeriesJob(context: ScrapeJobContext): Promise<ScrapeJobOutcome> {
  const { entry, settings, client, policy } = context
  const naming = settings.naming
  const enabled = enabledAssetKinds(settings.download)
  if (policy.localFirst) {
    context.log.warn('剧集刮削暂不支持本地优先，本次从互联网重新获取信息与图片')
  }

  // 1. 收集：关键词就是剧集目录名（已是剧集名时直接命中），年份只用来筛候选
  const collected = await collectFromPlugins(context, enabled, new Set(), (candidates) =>
    pickSeriesCandidate(candidates, entry.keyword, seriesYearOf(entry.name))
  )
  const detail = collected.detail
  if (!detail) {
    return {
      status: 'failed',
      pluginId: '',
      title: '',
      message: '未找到匹配的刮削结果',
      finalPath: entry.path
    }
  }
  const pluginId = collected.pluginId
  const assets = collected.assets

  // 2. 目录规范：`<剧集目录>/Season NN/S01E01 集名.ext`
  const rendered = renderTemplate(naming.seriesFolderTemplate, detail, naming).trim()
  const seriesBase = rendered.length > 0 ? rendered : entry.name
  const atLibraryRoot = policy.libraryRoots.includes(context.dirPath)
  const seriesDir = atLibraryRoot
    ? context.dirPath
    : policy.moveEnabled
      ? joinRemotePath(resolveOutputDir(policy.moveDirectory, context.dirPath), seriesBase)
      : basenameRemotePath(context.dirPath) === seriesBase
        ? context.dirPath
        : joinRemotePath(dirnameRemotePath(context.dirPath), seriesBase)
  if (atLibraryRoot) {
    context.log.warn(`剧集目录就是资料库目录，只在它下面按规范建季目录：${context.dirPath}`)
  }

  // 3. 剧集目录整树改名：一次移动 + 一次路径前缀改写（条目 id 与层级都不变）
  let episodes = listSeriesEpisodes(policy.libraryId, entry.itemId)
  let movedDir = false
  const oldDirs = new Set<string>()
  if (seriesDir !== context.dirPath) {
    try {
      await client.move(context.dirPath, seriesDir, { overwrite: false })
      replacePathPrefix(policy.libraryId, context.dirPath, seriesDir)
      movedDir = true
      oldDirs.add(context.dirPath)
      episodes = episodes.map((file) => ({
        ...file,
        path: seriesDir + file.path.slice(context.dirPath.length)
      }))
      context.log.info(`剧集目录已整理为：${seriesDir}`)
    } catch (error) {
      if (context.signal.aborted) throw new ScrapeError('cancelled')
      const message = error instanceof Error ? error.message : '未知错误'
      context.log.warn(`剧集目录整理失败，改为逐个整理集文件：${message}`)
    }
  }

  // 4. 季条目对齐：按季号分组，缺季条目就按确定性 ID 补一条
  const seasonItems = new Map<number, string>()
  for (const row of listSeasonItems(policy.libraryId, entry.itemId)) {
    if (!seasonItems.has(row.seasonNumber)) seasonItems.set(row.seasonNumber, row.id)
  }
  const seasons = new Map<number, SeriesEpisodeFile[]>()
  for (const file of episodes) {
    const bucket = seasons.get(file.seasonNumber)
    if (bucket) bucket.push(file)
    else seasons.set(file.seasonNumber, [file])
  }
  const seasonNumbers = [...seasons.keys()].sort((left, right) => left - right)

  const remoteEpisodes = indexRemoteEpisodes(detail)
  const seriesAssetContext: ScrapeAssetContext = {
    videoBase: basenameRemotePath(seriesDir),
    naming,
    fanartDirName: settings.scrape.fanartDirName
  }
  const episodeStills = (assets.get('still') ?? []).filter((asset) => asset.episode !== undefined)
  const seriesAssets = new Map(assets)
  seriesAssets.set(
    'still',
    (assets.get('still') ?? []).filter((asset) => asset.episode === undefined)
  )

  const plantedSeries: PlantedAsset[] = []
  let assetFailures = 0
  let moveFailures = 0
  let nfoWritten = 0
  let episodeCount = 0
  let missingRemoteCount = 0

  // 5. 剧集级产物：固定名图片 + tvshow.nfo（沿用旧 NFO 的还原记录）
  assetFailures += await landAssets(
    context,
    { dir: seriesDir, context: seriesAssetContext, assets: seriesAssets, kinds: enabled },
    plantedSeries
  )
  const seriesNfoPath = joinRemotePath(seriesDir, SERIES_NFO_NAME)
  const seriesCarried = await carryRestore(context, seriesNfoPath, {
    fileName: entry.name,
    directory: context.dirPath,
    files: []
  })
  const seriesRestore: NfoRestoreInfo = {
    ...seriesCarried,
    files: await mergeRestoreFiles(seriesCarried.files, plantedSeries, context)
  }
  try {
    await client.writeText(
      seriesNfoPath,
      buildTvShowNfoXml(detail, naming, artworkOf(plantedSeries), seriesRestore),
      { overwrite: true }
    )
    nfoWritten += 1
  } catch (error) {
    if (context.signal.aborted) throw new ScrapeError('cancelled')
    const message = error instanceof Error ? error.message : '未知错误'
    context.log.warn(`剧集 NFO 写入失败：${message}`)
  }

  // 6. 逐季整理：季目录 + 季 NFO / 海报 + 每集的改名、NFO、剧照、元数据
  for (const season of seasonNumbers) {
    const seasonFiles = seasons.get(season) ?? []
    const seasonName =
      renderSeasonFolderName(naming.seasonFolderTemplate, detail, naming, season).trim() ||
      `Season ${String(season).padStart(2, '0')}`
    const seasonDir = joinRemotePath(seriesDir, seasonName)
    await client.mkdir(seasonDir, { recursive: true })

    const existingSeasonItem = seasonItems.get(season)
    let seasonItem = existingSeasonItem ?? ''
    if (existingSeasonItem === undefined) {
      seasonItem = seasonItemId(policy.libraryId, context.connectionId, seriesDir, season)
      insertItem({
        id: seasonItem,
        libraryId: policy.libraryId,
        connectionId: context.connectionId,
        parentId: entry.itemId,
        type: 'season',
        name: seasonName,
        path: seasonDir,
        seasonNumber: season
      })
      seasonItems.set(season, seasonItem)
    } else {
      updateItem(existingSeasonItem, { name: seasonName, path: seasonDir })
    }

    // 季级：season.nfo + poster.jpg（插件没有季海报，先用剧集海报占位）
    const seasonAssetContext: ScrapeAssetContext = {
      videoBase: seasonName,
      naming,
      fanartDirName: settings.scrape.fanartDirName
    }
    const plantedSeason: PlantedAsset[] = []
    assetFailures += await landAssets(
      context,
      { dir: seasonDir, context: seasonAssetContext, assets: seriesAssets, kinds: ['poster'] },
      plantedSeason
    )
    const seasonNfoPath = joinRemotePath(seasonDir, SEASON_NFO_NAME)
    const seasonCarried = await carryRestore(context, seasonNfoPath, {
      fileName: seasonName,
      directory: seriesDir,
      files: []
    })
    try {
      await client.writeText(
        seasonNfoPath,
        buildSeasonNfoXml(season, seasonName, artworkOf(plantedSeason), {
          ...seasonCarried,
          files: await mergeRestoreFiles(seasonCarried.files, plantedSeason, context)
        }),
        { overwrite: true }
      )
      nfoWritten += 1
    } catch (error) {
      if (context.signal.aborted) throw new ScrapeError('cancelled')
      const message = error instanceof Error ? error.message : '未知错误'
      context.log.warn(`季 NFO 写入失败（${seasonNfoPath}）：${message}`)
    }
    replaceItemImages(seasonItem, imagesOf(plantedSeason, context))

    const seasonStills = episodeStills.filter((asset) => (asset.episode?.season ?? 1) === season)
    for (const file of seasonFiles) {
      episodeCount += 1
      const episodeNumber = file.episodeNumber
      const remote = remoteEpisodes.get(`${season}:${episodeNumber}`) ?? null
      if (!remote) missingRemoteCount += 1
      const renderedEpisode = renderEpisodeTemplate(naming.episodeFileTemplate, detail, naming, {
        showTitle: detail.title,
        season,
        episode: episodeNumber,
        episodeTitle: remote?.title ?? '',
        fileName: file.name
      }).trim()
      const base = renderedEpisode.length > 0 ? renderedEpisode : baseNameOf(file.name)
      const fromDir = dirnameRemotePath(file.path)
      const targetPath = joinRemotePath(seasonDir, movieFileName(base, extensionOf(file.name)))
      let finalPath = file.path
      if (targetPath !== file.path) {
        try {
          await client.move(file.path, targetPath, { overwrite: false })
          await refreshSourcePath(client, context.connectionId, file.itemId, file.path, targetPath)
          finalPath = targetPath
          if (fromDir !== seasonDir) oldDirs.add(fromDir)
        } catch (error) {
          if (context.signal.aborted) throw new ScrapeError('cancelled')
          moveFailures += 1
          const message = error instanceof Error ? error.message : '未知错误'
          context.log.warn(`集文件整理失败（${file.path}）：${message}`)
        }
      }
      const finalDir = dirnameRemotePath(finalPath)
      const finalBase = finalPath === targetPath ? base : baseNameOf(file.name)

      // 剧照：按「季 + 集号」匹配，落成 `<集基础名>-thumb.ext`
      const plantedEpisode: PlantedAsset[] = []
      const still = seasonStills.find((asset) => asset.episode?.index === episodeNumber)
      if (still) {
        const thumbPath = joinRemotePath(
          finalDir,
          `${finalBase}${EPISODE_THUMB_SUFFIX}.${assetExtension(still.url, 'jpg')}`
        )
        try {
          const kept = keepFlagOf(settings.download, 'still') && (await client.exists(thumbPath))
          if (!kept) {
            await ensureParent(context, thumbPath)
            await downloadAsset(context, thumbPath, still)
            context.log.info(`剧照已写入：${basenameRemotePath(thumbPath)}`)
          }
          plantedEpisode.push({
            kind: 'still',
            relativePath: basenameRemotePath(thumbPath),
            path: thumbPath,
            imageType: IMAGE_KIND_TYPE.still,
            created: !kept
          })
        } catch (error) {
          if (context.signal.aborted) throw new ScrapeError('cancelled')
          assetFailures += 1
          const message = error instanceof Error ? error.message : '未知错误'
          context.log.warn(`剧照写入失败（${file.name}）：${message}`)
        }
      }

      // 集 NFO：与集文件同名；沿用旧 NFO 的还原记录，写完后删掉旧名字那一份
      const oldNfoPath = joinRemotePath(fromDir, nfoFileName(baseNameOf(file.name)))
      const nfoTarget = joinRemotePath(finalDir, nfoFileName(finalBase))
      const episodeCarried = await carryRestore(context, oldNfoPath, {
        fileName: file.name,
        directory: fromDir,
        files: []
      })
      try {
        await client.writeText(
          nfoTarget,
          buildEpisodeNfoXml(
            detail,
            naming,
            {
              season,
              episode: episodeNumber,
              title: remote?.title ?? '',
              plot: remote?.plot,
              releaseDate: remote?.releaseDate,
              runtime: remote?.duration,
              still: plantedEpisode.find((item) => item.kind === 'still')?.path
            },
            {
              ...episodeCarried,
              files: await mergeRestoreFiles(episodeCarried.files, plantedEpisode, context)
            }
          ),
          { overwrite: true }
        )
        nfoWritten += 1
        if (nfoTarget !== oldNfoPath && (await client.exists(oldNfoPath))) {
          await client.remove(oldNfoPath)
          context.log.info(`已移除旧的集 NFO：${oldNfoPath}`)
        }
      } catch (error) {
        if (context.signal.aborted) throw new ScrapeError('cancelled')
        const message = error instanceof Error ? error.message : '未知错误'
        context.log.warn(`集 NFO 写入失败（${nfoTarget}）：${message}`)
      }

      // 集条目：元数据只写集自己的字段，季号 / 集号 / 归属同步落库
      updateItemMetadata(file.itemId, {
        ...metadataOf(detail, '', pluginId, file.itemId),
        title: remote?.title ?? `第 ${episodeNumber} 集`,
        num: '',
        overview: remote?.plot ?? '',
        premiereDate: remote?.releaseDate ?? '',
        runtimeMinutes: remote?.duration ?? 0,
        providerIds: remote?.id && pluginId.length > 0 ? { [pluginId]: remote.id } : {}
      })
      updateItem(file.itemId, {
        name: basenameRemotePath(finalPath),
        parentId: seasonItem,
        seasonNumber: season,
        episodeNumber
      })
      replaceItemImages(file.itemId, imagesOf(plantedEpisode, context))
    }
  }

  // 7. 剧集条目与演员名单
  if (movedDir) updateItem(entry.itemId, { path: seriesDir, name: seriesBase })
  updateItemMetadata(entry.itemId, metadataOf(detail, entry.num, pluginId, entry.itemId))
  replaceItemImages(entry.itemId, imagesOf(plantedSeries, context))
  try {
    const queued = enqueueItemActorScrape(
      entry.itemId,
      detail.actors ?? [],
      settings.scrape.actorScrape,
      context.signal
    )
    if (queued > 0) context.log.info(`已把 ${queued} 位演员排进资料抓取队列`)
  } catch (error) {
    const reason = error instanceof Error ? error.message : '未知错误'
    context.log.warn(`演员信息写入失败：${reason}`)
  }

  // 8. 搬家后空掉的旧目录（季目录改名、逐个移动留下的空目录）
  await pruneEmptyDirs(
    context,
    [...oldDirs].filter((dir) => dir !== seriesDir)
  )

  const parts = [pluginId.length > 0 ? `插件 ${pluginId}` : '本地信息', `${episodeCount} 集`]
  if (seasonNumbers.length > 0) parts.push(`${seasonNumbers.length} 季`)
  if (plantedSeries.length > 0) parts.push(`${plantedSeries.length} 个剧集资源`)
  if (nfoWritten > 0) parts.push(`${nfoWritten} 个 NFO`)
  if (assetFailures > 0) parts.push(`${assetFailures} 个资源失败`)
  if (moveFailures > 0) parts.push(`${moveFailures} 个集文件未整理`)
  if (missingRemoteCount > 0) parts.push(`${missingRemoteCount} 集没有远端详情`)
  if (seriesDir !== context.dirPath) parts.push(`→ ${seriesDir}`)

  return {
    status: 'success',
    pluginId,
    title: detail.title,
    message: parts.join('，'),
    finalPath: seriesDir
  }
}
