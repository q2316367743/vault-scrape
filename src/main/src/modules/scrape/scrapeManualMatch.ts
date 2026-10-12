/**
 * 手动匹配：把用户在弹窗里选中的候选**直接**灌进既有刮削流水线。
 *
 * 契约：
 * 1. 与自动刮削产物完全一致（命名整理、下载图片、写 NFO、必要时移动、回写条目元数据与演员），
 *    差别只有两点：跳过 search 与候选挑选（走 `ScrapeJobContext.forced`），并**忽略本地优先与保留已有图片**，
 *    保证用户这次选的元数据与封面真正落盘；
 * 2. 可选的插件只有「所属资料库的 scrapers ∩ 当前可用插件」，与批量任务同一口径；
 * 3. 与批量任务**互斥**：共用 `scrapeRunSlot`，已有刮削在跑时抛 `busy`；
 * 4. 不落任务表：手动匹配是单条即时执行，进度与结果由本函数的返回值与 IPC 信封承载。
 */
import { dirnameRemotePath } from '@common/types/file'
import { ScrapeError } from '@common/types/scrape'
import type { ScrapeMatchRequest, ScrapeMatchResult } from '@common/types/scrape'
import type { SettingDownload } from '@common/types/setting'
import type { MediaItemRow } from '$/db/schema/mediaItem'
import { getLibrary } from '$/db/repo/libraryRepo'
import { getItem, listSourcesByItem } from '$/db/repo/mediaRepo'
import { getFileClient } from '$/modules/file/fileClientManager'
import { primarySourceOf } from '$/modules/media/mediaWall'
import { keywordOf, runFileJob } from './scrapeFileJob'
import { createScrapeRunLog } from './scrapeLogFile'
import type { ScrapeJobContext, ScrapeJobOutcome } from './scrapeJobTypes'
import { libraryPolicy, snapshotSettings, usablePlugins } from './scrapeRunner'
import { releaseRunSlot, takeRunSlot } from './scrapeRunSlot'
import { runSeriesJob } from './scrapeSeriesJob'

/** 手动匹配时强制关闭的「保留已有图片」，让新选的封面与剧照覆盖旧图 */
const NO_KEEP: Pick<
  SettingDownload,
  'keepThumb' | 'keepPoster' | 'keepFanart' | 'keepStill' | 'keepTrailer'
> = {
  keepThumb: false,
  keepPoster: false,
  keepFanart: false,
  keepStill: false,
  keepTrailer: false
}

/** 条目在磁盘上的落点：手动匹配只认主源 */
interface MatchTarget {
  connectionId: string
  /** 影片：视频所在目录；剧集：剧集目录本身 */
  dirPath: string
  /** 影片：视频文件；剧集：剧集目录 */
  filePath: string
  /** 参与关键词解析的名字 */
  name: string
}

function resolveTarget(item: MediaItemRow): MatchTarget {
  if (item.type === 'series') {
    return {
      connectionId: item.connectionId,
      dirPath: item.path,
      filePath: item.path,
      name: item.name
    }
  }
  if (item.type !== 'movie') {
    throw new ScrapeError('invalidArgument', '该条目不支持手动匹配，请在影片或剧集详情页使用')
  }
  const source = primarySourceOf(item, listSourcesByItem(item.id))
  if (!source) throw new ScrapeError('notFound', '索引里没有这个条目的媒体源，请重新扫描资料库')
  return {
    connectionId: source.connectionId,
    dirPath: dirnameRemotePath(source.path),
    filePath: source.path,
    name: item.name
  }
}

/** 结果与流水线产物同形：状态、插件、标题、提示、最终路径 */
function toResult(itemId: string, outcome: ScrapeJobOutcome): ScrapeMatchResult {
  return {
    itemId,
    status: outcome.status,
    pluginId: outcome.pluginId,
    title: outcome.title,
    message: outcome.message,
    finalPath: outcome.finalPath
  }
}

/**
 * 按用户选中的候选刮削单条。
 *
 * 失败一律抛错，由 IPC 边界转成 `ScrapeResult` 信封（`describeScrapeError` 给中文文案）；
 * 流水线自身返回的 `failed`（例如详情取不到）原样透出。
 */
export async function matchItemManually(request: ScrapeMatchRequest): Promise<ScrapeMatchResult> {
  const itemId = request.itemId.trim()
  const pluginId = request.pluginId.trim()
  const movieId = request.movieId.trim()
  if (itemId.length === 0 || pluginId.length === 0 || movieId.length === 0) {
    throw new ScrapeError('invalidArgument', '手动匹配缺少条目、插件或候选 ID')
  }

  const item = getItem(itemId)
  if (!item) throw new ScrapeError('notFound', '索引里没有这个条目')
  const library = getLibrary(item.libraryId)
  if (!library) throw new ScrapeError('notFound', `资料库不存在：${item.libraryId}`)
  if (!library.scrapers.includes(pluginId)) {
    throw new ScrapeError('pluginMissing', '该刮削器不在资料库的刮削器列表里，请先在资料库设置里添加')
  }
  const plugin = usablePlugins([pluginId]).list[0]
  if (!plugin) {
    throw new ScrapeError('pluginMissing', '该刮削器当前不可用，请先在插件页启用并确认加载正常')
  }

  const target = resolveTarget(item)
  const taskId = `manual:${item.id}`
  const controller = takeRunSlot(taskId)
  const log = createScrapeRunLog(`手动匹配 ${target.name}`)

  try {
    const settings = snapshotSettings()
    const keyword = keywordOf(target.name)
    const context: ScrapeJobContext = {
      taskId,
      connectionId: target.connectionId,
      // 手动匹配的语义就是「用我选的这条」：不读本地、也不保留旧图
      policy: { ...libraryPolicy(library, target.connectionId), localFirst: false },
      dirPath: target.dirPath,
      entry: {
        itemId: item.id,
        path: target.filePath,
        name: target.name,
        keyword: keyword.keyword,
        num: keyword.num
      },
      plugins: [plugin],
      settings: { ...settings, download: { ...settings.download, ...NO_KEEP } },
      client: await getFileClient(target.connectionId),
      signal: controller.signal,
      log,
      forced: { pluginId, movieId }
    }

    const outcome =
      item.type === 'series' ? await runSeriesJob(context) : await runFileJob(context)
    log.info(`手动匹配结束：${outcome.status}，${outcome.message}`)
    return toResult(item.id, outcome)
  } finally {
    releaseRunSlot()
  }
}
