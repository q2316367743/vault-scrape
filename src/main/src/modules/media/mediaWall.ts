/**
 * 影视墙读模型：把「磁盘上的视频」与「刮削成果」拼成一面墙。
 *
 * 契约：
 * - 列表真相是资源索引（`resource` 表，`kind = 'video'`）：刮削没成功、甚至没刮削过的视频也上墙，
 *   磁盘上删掉的影片会自动从墙上消失；
 * - 补全分两级：先按路径命中「成功」的刮削记录（拿标题 / 番号 / 封面），
 *   再按同目录的刮削产出（NFO 与封面图）判断「已刮削」并取封面；
 * - 路径只在同一个 `connectionId` 内才有意义，跨存储绝不互相匹配；
 * - 只用「成功」的刮削记录补全（失败 / 待刮削的行没有产出，会污染墙面）；
 * - 详情另外读同目录 NFO 作为元信息；读失败不抛错，只当没有。
 */
import { FILE_ROOT, basenameRemotePath, joinRemotePath, normalizeRemotePath } from '@common/types/file'
import {
  MediaError,
  parseNfoXml,
  type MediaDetailRequest,
  type MediaDetailResult,
  type MediaNfoMeta,
  type MediaWallItem,
  type MediaWallResult
} from '@common/types/media'
import { buildResourceUrl, type ResourceItem } from '@common/types/resource'
import { extractKeyword, stripExtension, type ScrapeFileItem } from '@common/types/scrape'
import { getResourceById, listResourceByKind, maxResourceIndexedAt } from '$/db/repo/resourceRepo'
import { listScrapeWithConnection } from '$/db/repo/scrapeRepo'
import { getFileClient } from '$/modules/file/fileClientManager'
import { resourceIdOf } from '$/modules/resource/resourceIndex'

/** 一个连接内的刮削记录索引：一个视频可能同时被「最终路径」和「原路径」命中 */
interface ScrapeIndex {
  /** 刮削后的最终路径 → 记录（旧数据没有 finalPath 时用 path 兜底） */
  byFinalPath: Map<string, ScrapeFileItem>
  /** 扫描时的原路径 → 记录（覆盖改名前的旧路径） */
  byPath: Map<string, ScrapeFileItem>
}

/**
 * 只有成功的刮削记录才有产出，才允许用来补全墙面。
 *
 * 取消 / 失败留下的行标题与封面都是空的，如果参与匹配会让卡片显示成「已刮削但没有信息」。
 */
const USABLE_STATUS = 'success' as const

/** 同目录封面图的命名优先级：越靠前越像封面，不在表里的按文件名兜底 */
const COVER_NAME_ORDER = ['poster', 'folder', 'cover', 'fanart', 'backdrop', 'banner', 'thumb']

/** 一个目录里的刮削产出：有 NFO 就算这个目录刮过，图片用来当封面 */
interface DirEvidence {
  hasNfo: boolean
  cover: { id: string; name: string } | null
}

/** 目录键：同一个连接内的目录才可能互相补全，跨存储绝不串味 */
function dirKey(connectionId: string, dirPath: string): string {
  return `${connectionId}\n${dirPath}`
}

function coverRank(name: string): number {
  const rank = COVER_NAME_ORDER.indexOf(stripExtension(name).toLowerCase())
  return rank === -1 ? COVER_NAME_ORDER.length : rank
}

/**
 * 按目录收集「刮削产出」证据，只查索引、不碰磁盘。
 *
 * 这是路径配对的兜底：加 `final_path` 之前的旧记录、以及刮削之外的手工改名 / 移动，
 * 都会让 `scrape_file` 对不上磁盘，但流水线写下的 NFO 与封面就躺在视频旁边，按目录即可补全。
 */
function buildDirEvidence(): Map<string, DirEvidence> {
  const evidence = new Map<string, DirEvidence>()
  const slotOf = (connectionId: string, dirPath: string): DirEvidence => {
    const key = dirKey(connectionId, dirPath)
    let slot = evidence.get(key)
    if (!slot) {
      slot = { hasNfo: false, cover: null }
      evidence.set(key, slot)
    }
    return slot
  }
  for (const item of listResourceByKind('nfo')) {
    slotOf(item.connectionId, item.dirPath).hasNfo = true
  }
  for (const item of listResourceByKind('image')) {
    const slot = slotOf(item.connectionId, item.dirPath)
    if (!slot.cover || coverRank(item.name) < coverRank(slot.cover.name)) {
      slot.cover = { id: item.id, name: item.name }
    }
  }
  return evidence
}

/** 按连接分组，同一路径只保留更新时间最新的一条（查询已按 updatedAt 降序） */
function buildScrapeIndex(): Map<string, ScrapeIndex> {
  const index = new Map<string, ScrapeIndex>()
  for (const { item, connectionId } of listScrapeWithConnection(USABLE_STATUS)) {
    if (item.title.length === 0 && item.coverId.length === 0) continue
    const bucket = index.get(connectionId) ?? { byFinalPath: new Map(), byPath: new Map() }
    const finalPath = item.finalPath.length > 0 ? item.finalPath : item.path
    if (!bucket.byFinalPath.has(finalPath)) bucket.byFinalPath.set(finalPath, item)
    if (!bucket.byPath.has(item.path)) bucket.byPath.set(item.path, item)
    index.set(connectionId, bucket)
  }
  return index
}

function findRecord(index: Map<string, ScrapeIndex>, item: ResourceItem): ScrapeFileItem | undefined {
  const bucket = index.get(item.connectionId)
  if (!bucket) return undefined
  return bucket.byFinalPath.get(item.path) ?? bucket.byPath.get(item.path)
}

/** 番号：优先从磁盘上的文件名解析（刮削可能改过名），再退回刮削记录的关键词 */
function numOf(item: ResourceItem, record: ScrapeFileItem | undefined): string {
  const parsed = extractKeyword(item.name).num
  if (parsed.length > 0) return parsed
  return record?.keyword ?? ''
}

/** 标题：插件标题优先，没有就用去掉扩展名的文件名占位 */
function titleOf(item: ResourceItem, record: ScrapeFileItem | undefined): string {
  if (record && record.title.length > 0) return record.title
  return stripExtension(item.name)
}

/**
 * 封面地址：优先用刮削记录的封面（资源 ID 是「存储 + 封面路径」的哈希，定位靠它），
 * 记录对不上时退回同目录的封面图；两处都补上封面路径的基名（与工作台同一套写法）。
 */
function coverUrlOf(
  item: ResourceItem,
  record: ScrapeFileItem | undefined,
  evidence: DirEvidence | undefined
): string {
  if (record && record.coverId.length > 0) {
    const coverPath = record.coverPath.length > 0 ? record.coverPath : item.name
    return buildResourceUrl(item.connectionId, record.coverId, basenameRemotePath(coverPath))
  }
  if (!evidence || !evidence.cover) return ''
  return buildResourceUrl(item.connectionId, evidence.cover.id, evidence.cover.name)
}

function toWallItem(
  item: ResourceItem,
  record: ScrapeFileItem | undefined,
  evidence: DirEvidence | undefined
): MediaWallItem {
  return {
    connectionId: item.connectionId,
    path: item.path,
    dirPath: item.dirPath,
    name: item.name,
    num: numOf(item, record),
    title: titleOf(item, record),
    coverUrl: coverUrlOf(item, record, evidence),
    playUrl: buildResourceUrl(item.connectionId, item.id, item.name),
    scraped: record !== undefined || evidence?.hasNfo === true,
    scrapedAt: record?.updatedAt ?? 0,
    pluginId: record?.pluginId ?? '',
    size: item.size,
    modifiedAt: item.modifiedAt
  }
}

/** 一次拉全整墙：所有数据源的视频混在一起，筛选与排序都在渲染层做 */
export function loadMediaWall(): MediaWallResult {
  const index = buildScrapeIndex()
  const evidence = buildDirEvidence()
  const items = listResourceByKind('video').map((item) =>
    toWallItem(item, findRecord(index, item), evidence.get(dirKey(item.connectionId, item.dirPath)))
  )
  return {
    items,
    total: items.length,
    scrapedCount: items.filter((item) => item.scraped).length,
    indexedAt: maxResourceIndexedAt()
  }
}

/** 同目录 NFO 候选：`movie.nfo` 优先，其次与视频同名的 `.nfo`（与写入侧的命名规则对应） */
function nfoCandidates(item: ResourceItem): string[] {
  return ['movie.nfo', `${stripExtension(item.name)}.nfo`]
}

/** 读同目录 NFO；连接不可用、文件不存在、解析失败都只当作「没有 NFO」 */
async function readNfoMeta(item: ResourceItem): Promise<{ meta: MediaNfoMeta | null; path: string }> {
  for (const name of nfoCandidates(item)) {
    const target = joinRemotePath(item.dirPath, name)
    try {
      const client = await getFileClient(item.connectionId)
      if (!(await client.exists(target))) continue
      const text = await client.readText(target)
      return { meta: parseNfoXml(text), path: target }
    } catch {
      // 换下一个候选；全都读不到时按没有 NFO 处理
    }
  }
  return { meta: null, path: '' }
}

/** 单个视频的详情：与墙上同一套补全规则 + 同目录 NFO */
export async function loadMediaDetail(request: MediaDetailRequest): Promise<MediaDetailResult> {
  const connectionId = request.connectionId.trim()
  const path = normalizeRemotePath(request.path)
  if (connectionId.length === 0) throw new MediaError('invalidArgument', '缺少数据源')
  if (path.length === 0 || path === FILE_ROOT) throw new MediaError('invalidArgument', '缺少视频路径')

  const resource = getResourceById(resourceIdOf(connectionId, path))
  if (!resource || resource.connectionId !== connectionId || resource.kind !== 'video') {
    throw new MediaError('notFound')
  }

  const item = toWallItem(
    resource,
    findRecord(buildScrapeIndex(), resource),
    buildDirEvidence().get(dirKey(resource.connectionId, resource.dirPath))
  )
  const nfo = await readNfoMeta(resource)
  return { item, meta: nfo.meta, nfoPath: nfo.path }
}
