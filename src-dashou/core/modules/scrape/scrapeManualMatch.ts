/**
 * 手动匹配：把用户在弹窗里选中的候选变成**一条真正的刮削任务**。
 *
 * 契约：
 * 1. 产物与自动刮削完全一致（命名整理、下载图片、写 NFO、必要时移动、回写条目元数据与演员），
 *    差别只有两点：跳过 `search` 与候选挑选（走 `ScrapeJobContext.forced`），并**忽略本地优先与
 *    保留已有图片**，保证用户这次选的元数据与封面真正落盘；
 * 2. 可选的插件只有「所属资料库的 scrapers ∩ 当前可用插件」，与批量任务同一口径；
 * 3. 与批量任务**互斥**：共用 `scrapeRunSlot`（由 `startScrapeTaskForEntries` 判断），已有刮削在跑时抛 `busy`；
 * 4. **立即返回**：任务会落 `task` / `scrape_file` 并广播 `scrape:progress`，调用方拿到 `taskId`
 *    后跳进度详情页（`/overview/scrape?taskId=…`）即可，**不要在这里等流水线跑完**（那是分钟级的事）。
 */
import { dirnameRemotePath } from '@common/types/file'
import { ScrapeError } from '@common/types/scrape'
import type { ScrapeMatchRequest, ScrapeMatchResult, ScrapeScanEntry } from '@common/types/scrape'
import type { MediaItemRow } from '$/db/schema/mediaItem'
import { getLibrary } from '$/db/repo/libraryRepo'
import { getItem, listSourcesByItem } from '$/db/repo/mediaRepo'
import { primarySourceOf } from '$/modules/media/mediaWall'
import { keywordOf } from './scrapeFileJob'
import { MANUAL_MATCH_TASK_PREFIX } from './scrapeManualPolicy'
import { startScrapeTaskForEntries } from './scrapeRunner'
import { usablePlugins } from './scrapeUsablePlugins'

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

/**
 * 按用户选中的候选刮削单条：校验通过后建任务并立即返回任务 ID。
 *
 * 校验失败一律抛错，由 IPC 边界转成 `ScrapeResult` 信封（`describeScrapeError` 给中文文案）；
 * 任务建好之后的过程与失败原因都在任务的逐文件结果里（`scrape:getTask` / 进度详情页）。
 */
export function matchItemManually(request: ScrapeMatchRequest): ScrapeMatchResult {
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
  const keyword = keywordOf(target.name)
  const entry: ScrapeScanEntry = {
    itemId: item.id,
    path: target.filePath,
    name: target.name,
    // 体积与修改时间只用于扫描期排序 / 过滤，手动匹配用不到，占位即可
    size: 0,
    modifiedAt: Date.now(),
    keyword: keyword.keyword,
    num: keyword.num
  }
  const task = startScrapeTaskForEntries({
    connectionId: target.connectionId,
    libraryId: library.id,
    dirPath: target.dirPath,
    taskName: `${MANUAL_MATCH_TASK_PREFIX}${target.name}`,
    entries: [entry],
    scraperIds: [pluginId],
    forced: { pluginId, movieId }
  })
  return { itemId: item.id, taskId: task.id }
}
