/**
 * `storage://` 私有协议：把媒体 ID 换成真实文件内容。
 *
 * 契约：
 * - 地址形如 `storage://{存储ID}/{媒体ID}/{原始文件名}`，**只认 ID，不接受绝对路径**，
 *   所以渲染层拿不到、也构造不出越权地址；
 * - 解析顺序：媒体源表（`media_source`）→ 图片表（`media_image`，刮削图 / 扫描封面）；
 * - 视频（`kind === 'video'`）走 Range 流式：主进程自己解析 Range 头按区间读，
 *   本机直读磁盘、WebDAV 用原生 Range、SMB 用补丁后的区间读，应答 200 / 206 / 416
 *   （`net.fetch` 不会转发 Range 头，非 faststart 的 MP4 会整段加载失败，故不能走它）；
 * - 其它媒体（图片、NFO）沿用 `net.fetch`：本地直接读磁盘，远端先落本机缓存再读；
 * - 任何失败都返回 404 并只记日志（同一媒体 60 秒内只记一条），不把异常抛回渲染层。
 */
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync } from 'fs'
import { join, resolve, sep } from 'path'
import { pathToFileURL } from 'url'
import { app, net, protocol } from 'electron'
import { guessMimeType, type FileConnection } from '@common/types/file'
import {
  MEDIA_ID_PATTERN,
  MEDIA_SCHEME,
  mediaSourceKindOf,
  parseMediaUrl,
  type MediaSourceKind
} from '@common/types/media'
import { appendLog } from '$/db/repo/logRepo'
import { getImage } from '$/db/repo/mediaImageRepo'
import { getSource } from '$/db/repo/mediaRepo'
import { getConnection } from '$/modules/file/fileConnectionStore'
import { APPDATA_CONNECTION_ID, appDataImageRoot } from '$/modules/media/mediaAppData'
import { resolveInsideRoot } from '$/modules/file/impl/local/localPath'
import { getFileClient } from '$/modules/file/fileClientManager'
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

interface MediaTarget {
  /** 连接内绝对路径 */
  path: string
  /** 已知大小；0 表示未知（图片不记大小） */
  size: number
  /** 媒体类型：决定走 Range 流式（video）还是 `net.fetch` */
  kind: MediaSourceKind
}

/** 媒体源表优先，图片表兜底（媒体源被重扫清掉后封面仍可显示） */
function resolveTarget(connectionId: string, mediaId: string): MediaTarget | null {
  const source = getSource(mediaId)
  if (source && source.connectionId === connectionId) {
    return { path: source.path, size: source.size, kind: mediaSourceKindOf(source.mime, source.extname) }
  }

  const image = getImage(mediaId)
  if (!image || image.connectionId !== connectionId || image.path.length === 0) return null
  return { path: image.path, size: 0, kind: 'image' }
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
async function ensureCached(connection: FileConnection, mediaId: string, target: MediaTarget): Promise<string> {
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

async function downloadToCache(connection: FileConnection, target: MediaTarget, file: string): Promise<string> {
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

/**
 * 视频请求：当自己的 Range 服务端。
 *
 * 大小与 MIME 以 `stat` 为准（索引可能过期，而 206 的 `Content-Range` 必须和真实大小一致）；
 * 流的取消由 `toWebStream` 传播成 `destroy()`，拖进度条 / 关页面都不会漏句柄。
 */
async function handleVideoRequest(
  connection: FileConnection,
  target: MediaTarget,
  request: Request
): Promise<Response> {
  const client = await getFileClient(connection.id)
  const info = await client.stat(target.path)
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
  const stream = await client.readRange(target.path, start, end)
  const headers = new Headers({
    'Content-Type': info.mime.length > 0 ? info.mime : guessMimeType(info.name),
    'Content-Length': `${end - start + 1}`,
    'Accept-Ranges': 'bytes'
  })

  if (!parsed) {
    return new Response(toWebStream(stream), { status: 200, headers })
  }
  headers.set('Content-Range', `bytes ${start}-${end}/${total}`)
  return new Response(toWebStream(stream), { status: 206, headers })
}

async function handleMediaRequest(request: Request): Promise<Response> {
  const parts = parseMediaUrl(request.url)
  if (!parts) return notFound()
  const { connectionId, mediaId } = parts
  if (!CONNECTION_ID_PATTERN.test(connectionId) || !MEDIA_ID_PATTERN.test(mediaId)) {
    return notFound()
  }
  try {
    const target = resolveTarget(connectionId, mediaId)
    if (!target) return notFound()
    // 应用数据目录（imageSaveMode = 'appdata'）里的图片不在任何连接内，按绝对路径直接读盘；
    // 路径虽然来自本机库文件，仍复核一次归属，避免脏数据把协议变成任意文件读
    if (connectionId === APPDATA_CONNECTION_ID) {
      const file = resolve(target.path)
      const root = resolve(appDataImageRoot())
      if (!file.startsWith(root + sep)) return notFound()
      return await net.fetch(pathToFileURL(file).toString())
    }
    const connection = getConnection(connectionId)
    if (!connection) return notFound()
    if (target.kind === 'video') return await handleVideoRequest(connection, target, request)
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
