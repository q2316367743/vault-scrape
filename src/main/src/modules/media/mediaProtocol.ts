/**
 * `storage://` 私有协议：把媒体 ID 换成真实文件内容。
 *
 * 契约：
 * - 地址形如 `storage://{存储ID}/{媒体ID}/{原始文件名}`，**只认 ID，不接受绝对路径**，
 *   所以渲染层拿不到、也构造不出越权地址；
 * - 存储页的只读预览另有路径形式 `storage://{存储ID}/path/{编码后的连接内路径}`
 *   （构造与解析见 `@common/types/file` 的 buildFilePreviewUrl / parseFilePreviewUrl）：
 *   只复核「连接存在 + 路径落在连接根内 + 确实是文件」，越界或不存在一律 404；
 *   视频与音频走 Range，图片与 NFO 走 `net.fetch`（远端先落缓存）；
 * - 解析顺序：媒体源表（`media_source`）→ 图片表（`media_image`，刮削图 / 扫描封面）；
 * - 视频（`kind === 'video'`）走 Range 流式：主进程自己解析 Range 头按区间读，
 *   本机直读磁盘、WebDAV 用原生 Range、SMB 用补丁后的区间读，应答 200 / 206 / 416
 *   （`net.fetch` 不会转发 Range 头，非 faststart 的 MP4 会整段加载失败，故不能走它）；
 * - 其它媒体（图片、NFO）沿用 `net.fetch`：本地直接读磁盘，远端先落本机缓存再读；
 * - 视频请求发现索引路径过期（文件被移动 / 整理过）时，先按「文件名 + 字节数」在本资料库
 *   范围内找回文件并把新路径写回 `media_source`（source ID 不变），再把这次请求读完；
 *   找不回来仍是 404；
 * - 任何失败都返回 404 并只记日志（同一媒体 60 秒内只记一条），不把异常抛回渲染层。
 */
import { createHash, randomUUID } from 'crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { app, net, protocol } from 'electron'
import {
  filePreviewKindOf,
  guessMimeType,
  parseFilePreviewUrl,
  type FileConnection,
  type FileEntry,
  type FilePreviewTarget
} from '@common/types/file'
import {
  MEDIA_ID_PATTERN,
  MEDIA_SCHEME,
  mediaSourceKindOf,
  parseMediaUrl,
  type MediaSourceKind
} from '@common/types/media'
import { appendLog } from '$/db/repo/logRepo'
import { getImage } from '$/db/repo/mediaImageRepo'
import { getSource, updateSourcePath } from '$/db/repo/mediaRepo'
import { getConnection } from '$/modules/file/fileConnectionStore'
import { resolveInsideRoot } from '$/modules/file/impl/local/localPath'
import { isNotFoundError } from '$/modules/file/fileErrorUtils'
import { getFileClient } from '$/modules/file/fileClientManager'
import { locateMovedFile } from '$/modules/media/mediaLocator'
import { toWebStream } from '$/modules/file/streamToWeb'

const CONNECTION_ID_PATTERN = /^[a-z0-9-]{1,64}$/
/** 远端资源缓存上限（按 mtime 由旧到新剪枝；本轮不是完整 LRU） */
const CACHE_MAX_BYTES = 512 * 1024 * 1024
const CACHE_PRUNE_INTERVAL_MS = 60_000
const LOG_INTERVAL_MS = 60_000

/** 正在下载的资源：同一 ID 的并发请求共享同一次下载 */
const pending = new Map<string, Promise<string>>()
const lastLoggedAt = new Map<string, number>()
let nextPruneAt = 0

/** 协议必须在 app ready 之前注册为特权协议，否则自定义协议在渲染层不可用 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/** 在 app ready 之后接管协议请求 */
export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, (request) => handleMediaRequest(request))
}

/** 远端媒体缓存目录：每个媒体一个文件，文件名就是媒体 ID */
function cacheDir(): string {
  return join(app.getPath('home'), '.vault-scrape', 'cache', 'media')
}

function notFound(): Response {
  return new Response(null, { status: 404 })
}

function warnOnce(key: string, message: string): void {
  const now = Date.now()
  const last = lastLoggedAt.get(key) ?? 0
  if (now - last < LOG_INTERVAL_MS) return
  lastLoggedAt.set(key, now)
  appendLog({ level: 'warn', scope: 'media', message })
}

/** Range 流式服务需要的最小上下文（存储页预览没有索引，两个 ID 为空串） */
interface RangeTarget {
  /** 连接内绝对路径 */
  path: string
  /** 已知大小；0 表示未知（图片不记大小） */
  size: number
  /** 媒体源 ID（图片为空串）：路径自愈要拿它把新路径写回索引 */
  sourceId: string
  /** 媒体源所属资料库（图片为空串）：自愈时用它圈定查找范围 */
  libraryId: string
}

interface MediaTarget extends RangeTarget {
  /** 媒体类型：决定走 Range 流式（video）还是 `net.fetch` */
  kind: MediaSourceKind
}

/** 媒体源表优先，图片表兜底（媒体源被重扫清掉后封面仍可显示） */
function resolveTarget(connectionId: string, mediaId: string): MediaTarget | null {
  const source = getSource(mediaId)
  if (source && source.connectionId === connectionId) {
    return {
      path: source.path,
      size: source.size,
      kind: mediaSourceKindOf(source.mime, source.extname),
      sourceId: source.id,
      libraryId: source.libraryId
    }
  }

  const image = getImage(mediaId)
  if (!image || image.connectionId !== connectionId || image.path.length === 0) return null
  return { path: image.path, size: 0, kind: 'image', sourceId: '', libraryId: '' }
}

function isCacheUsable(file: string, size: number): boolean {
  if (!existsSync(file)) return false
  if (size <= 0) return true
  try {
    return statSync(file).size === size
  } catch {
    return false
  }
}

/** 远端媒体落本机缓存；同一 ID 并发只下载一次 */
async function ensureCached(
  connection: FileConnection,
  mediaId: string,
  target: RangeTarget
): Promise<string> {
  const file = join(cacheDir(), mediaId)
  if (isCacheUsable(file, target.size)) return file
  const existing = pending.get(mediaId)
  if (existing) return existing
  const task = downloadToCache(connection, target, file).finally(() => {
    pending.delete(mediaId)
  })
  pending.set(mediaId, task)
  return task
}

async function downloadToCache(
  connection: FileConnection,
  target: RangeTarget,
  file: string
): Promise<string> {
  const temp = `${file}.${randomUUID()}.tmp`
  mkdirSync(cacheDir(), { recursive: true })
  try {
    const client = await getFileClient(connection.id)
    await client.download(target.path, temp)
    renameSync(temp, file)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
  pruneCache()
  return file
}

/** 缓存剪枝：超过上限时按 mtime 由旧到新删到 80% 以下 */
function pruneCache(): void {
  const now = Date.now()
  if (now < nextPruneAt) return
  nextPruneAt = now + CACHE_PRUNE_INTERVAL_MS
  try {
    const dir = cacheDir()
    if (!existsSync(dir)) return
    const entries = readdirSync(dir)
      .filter((name) => !name.endsWith('.tmp'))
      .map((name) => {
        const path = join(dir, name)
        try {
          const stat = statSync(path)
          return { path, size: stat.size, at: stat.mtimeMs }
        } catch {
          return null
        }
      })
      .filter((entry): entry is { path: string; size: number; at: number } => entry !== null)
    let total = entries.reduce((sum, entry) => sum + entry.size, 0)
    if (total <= CACHE_MAX_BYTES) return
    const target = CACHE_MAX_BYTES * 0.8
    entries.sort((left, right) => left.at - right.at)
    for (const entry of entries) {
      if (total <= target) break
      try {
        unlinkSync(entry.path)
        total -= entry.size
      } catch {
        // 单个文件删不掉不影响其他文件
      }
    }
  } catch {
    // 剪枝失败只影响缓存大小
  }
}

/** 单个字节区间（闭区间，含 end） */
interface ByteRange {
  start: number
  end: number
}

/**
 * 解析单区间 Range 头：`bytes=start-end` / `bytes=start-` / `bytes=-suffix`。
 *
 * - 尾部探测（`bytes=-N`）必须支持：Chromium 靠它去文件末尾读 moov，非 faststart 的 MP4 全靠这一下；
 * - 多区间（`bytes=0-1,5-6`）与非法值一律返回 null，退化成 200 全量，不做 multipart/byteranges；
 * - start 超出文件大小返回 'unsatisfiable'，由调用方应答 416。
 */
function parseByteRange(header: string | null, total: number): ByteRange | 'unsatisfiable' | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const rawStart = match[1] ?? ''
  const rawEnd = match[2] ?? ''
  if (rawStart === '' && rawEnd === '') return null

  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    return { start: Math.max(0, total - suffix), end: total - 1 }
  }

  const start = Number(rawStart)
  if (!Number.isFinite(start) || start >= total) return 'unsatisfiable'
  if (rawEnd === '') return { start, end: total - 1 }

  const end = Number(rawEnd)
  if (!Number.isFinite(end) || end < start) return 'unsatisfiable'
  return { start, end: Math.min(end, total - 1) }
}

/** 正在自愈的媒体源：同一个源的并发 Range 请求共享一次查找 */
const healing = new Map<string, Promise<FileEntry | null>>()

/**
 * 索引里的路径失效时，按「文件名 + 字节数」把文件找回来并把新路径写回媒体源。
 *
 * 只处理「文件不存在」：权限 / 断线之类的错误照旧抛给上层记日志。写库失败（例如新路径
 * 已经被别的媒体源占用）不影响本次播放，只是下次起播还要再找一次。
 */
function healMovedVideo(
  connectionId: string,
  target: RangeTarget,
  error: unknown
): Promise<FileEntry | null> {
  if (!isNotFoundError(error) || target.sourceId.length === 0) return Promise.resolve(null)
  const existing = healing.get(target.sourceId)
  if (existing) return existing
  const task = relocateSource(connectionId, target).finally(() => {
    healing.delete(target.sourceId)
  })
  healing.set(target.sourceId, task)
  return task
}

async function relocateSource(connectionId: string, target: RangeTarget): Promise<FileEntry | null> {
  const located = await locateMovedFile({
    connectionId,
    libraryId: target.libraryId,
    path: target.path,
    size: target.size
  })
  if (!located) return null
  try {
    updateSourcePath(target.sourceId, {
      path: located.path,
      name: located.name,
      extname: located.extname,
      mime: located.mime,
      size: located.size,
      modifiedAt: located.modifiedAt
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    warnOnce(target.sourceId, `索引路径已找回但写回失败（${connectionId}/${target.sourceId}）：${message}`)
  }
  appendLog({
    level: 'info',
    scope: 'media',
    message: `索引路径失效，已按文件名找回：${target.path} → ${located.path}`
  })
  return located
}

/**
 * 当自己的 Range 服务端：影视墙的视频、存储页预览里的视频与音频都走这里。
 *
 * 大小与 MIME 以 `stat` 为准（索引可能过期，而 206 的 `Content-Range` 必须和真实大小一致）；
 * stat 报「文件不存在」时先尝试按文件名 + 大小自愈一次，找回来的新路径同时用于 `readRange`
 * （存储页预览的 sourceId 为空，自愈直接不触发）；
 * 流的取消由 `toWebStream` 传播成 `destroy()`，拖进度条 / 关页面都不会漏句柄。
 */
async function handleRangeRequest(
  connection: FileConnection,
  target: RangeTarget,
  request: Request
): Promise<Response> {
  const client = await getFileClient(connection.id)
  let filePath = target.path
  let info: FileEntry
  try {
    info = await client.stat(filePath)
  } catch (error) {
    const healed = await healMovedVideo(connection.id, target, error)
    if (!healed) throw error
    filePath = healed.path
    info = healed
  }
  if (info.type !== 'file' || info.size <= 0) return notFound()

  const total = info.size
  const parsed = parseByteRange(request.headers.get('range'), total)
  if (parsed === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${total}`, 'Accept-Ranges': 'bytes' }
    })
  }

  const start = parsed ? parsed.start : 0
  const end = parsed ? parsed.end : total - 1
  const stream = await client.readRange(filePath, start, end)
  const headers = new Headers({
    'Content-Type': contentTypeOf(info),
    'Content-Length': `${end - start + 1}`,
    'Accept-Ranges': 'bytes'
  })

  if (!parsed) {
    return new Response(toWebStream(stream), { status: 200, headers })
  }
  headers.set('Content-Range', `bytes ${start}-${end}/${total}`)
  return new Response(toWebStream(stream), { status: 206, headers })
}

/** 响应 MIME：协议给的优先，没有就按扩展名兜底 */
function contentTypeOf(info: FileEntry): string {
  return info.mime.length > 0 ? info.mime : guessMimeType(info.name)
}

/** 磁盘文件交给 `net.fetch` 读，并显式带上 MIME（远端缓存文件名没有扩展名，兜不出类型） */
async function serveFile(file: string, info: FileEntry): Promise<Response> {
  const response = await net.fetch(pathToFileURL(file).toString())
  const headers = new Headers(response.headers)
  headers.set('Content-Type', contentTypeOf(info))
  return new Response(response.body, { status: response.status, headers })
}

/** 存储页预览的缓存键：连接 + 路径的哈希（缓存文件名不能带路径分隔符） */
function previewCacheKey(connectionId: string, path: string): string {
  return createHash('sha1').update(`${connectionId}\n${path}`).digest('hex')
}

/**
 * 存储页只读预览：`storage://{连接ID}/path/{编码后的连接内路径}`。
 *
 * 与媒体 ID 地址不同，这里没有索引可用，只能按真实路径读，所以每条请求都现场 stat 一次；
 * 路径归属由 `resolveInsideRoot`（本地）与 FileClient 内的 `normalizeRemotePath`（远端）
 * 双重保证，出不了连接根。视频与音频走 Range，图片与 NFO 走 `net.fetch`。
 */
async function handleFilePreviewRequest(target: FilePreviewTarget, request: Request): Promise<Response> {
  const { connectionId, path } = target
  if (!CONNECTION_ID_PATTERN.test(connectionId)) return notFound()
  const connection = getConnection(connectionId)
  if (!connection) return notFound()

  const client = await getFileClient(connectionId)
  const info = await client.stat(path)
  if (info.type !== 'file' || info.size <= 0) return notFound()

  const kind = filePreviewKindOf(info.mime, info.extname)
  if (kind === 'video' || kind === 'audio') {
    return await handleRangeRequest(
      connection,
      { path, size: info.size, sourceId: '', libraryId: '' },
      request
    )
  }

  if (connection.protocol === 'local') {
    return await serveFile(resolveInsideRoot(connection.rootPath, path), info)
  }
  const cached = await ensureCached(connection, previewCacheKey(connectionId, path), {
    path,
    size: info.size,
    sourceId: '',
    libraryId: ''
  })
  return await serveFile(cached, info)
}

async function handleMediaRequest(request: Request): Promise<Response> {
  const preview = parseFilePreviewUrl(request.url)
  if (preview) {
    try {
      return await handleFilePreviewRequest(preview, request)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      warnOnce(
        `preview:${preview.connectionId}:${preview.path}`,
        `存储页预览读取失败（${preview.connectionId}/${preview.path}）：${message}`
      )
      return notFound()
    }
  }

  const parts = parseMediaUrl(request.url)
  if (!parts) return notFound()
  const { connectionId, mediaId } = parts
  if (!CONNECTION_ID_PATTERN.test(connectionId) || !MEDIA_ID_PATTERN.test(mediaId)) {
    return notFound()
  }
  try {
    const target = resolveTarget(connectionId, mediaId)
    if (!target) return notFound()
    const connection = getConnection(connectionId)
    if (!connection) return notFound()
    if (target.kind === 'video') return await handleRangeRequest(connection, target, request)
    if (connection.protocol === 'local') {
      const osPath = resolveInsideRoot(connection.rootPath, target.path)
      return await net.fetch(pathToFileURL(osPath).toString())
    }
    const cached = await ensureCached(connection, mediaId, target)
    return await net.fetch(pathToFileURL(cached).toString())
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    warnOnce(mediaId, `媒体读取失败（${connectionId}/${mediaId}）：${message}`)
    return notFound()
  }
}
