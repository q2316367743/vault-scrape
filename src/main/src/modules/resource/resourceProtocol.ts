/**
 * `storage://` 私有协议：把资源 ID 换成真实文件内容。
 *
 * 契约：
 * - 地址形如 `storage://{存储ID}/{资源ID}/{原始文件名}`，**只认 ID，不接受绝对路径**，
 *   所以渲染层拿不到、也构造不出越权地址；
 * - 解析顺序：资源索引表 → 结果行封面兜底（索引被清空后封面仍可显示）；
 * - 本地存储直接读磁盘（`net.fetch` 自带 Range/流式），远端存储把整文件落到本机缓存后再读；
 * - 任何失败都返回 404 并只记日志（同一资源 60 秒内只记一条），不把异常抛回渲染层。
 */
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { app, net, protocol } from 'electron'
import type { FileConnection } from '@common/types/file'
import { RESOURCE_SCHEME, parseResourceUrl } from '@common/types/resource'
import { appendLog } from '$/db/repo/logRepo'
import { getResourceById } from '$/db/repo/resourceRepo'
import { findScrapeFileByCoverId } from '$/db/repo/scrapeRepo'
import { getTask } from '$/db/repo/taskRepo'
import { getConnection } from '$/modules/file/fileConnectionStore'
import { resolveInsideRoot } from '$/modules/file/impl/local/localPath'
import { getFileClient } from '$/modules/file/fileClientManager'

const CONNECTION_ID_PATTERN = /^[a-z0-9-]{1,64}$/
const RESOURCE_ID_PATTERN = /^[0-9a-f]{16}$/
/** 远端资源缓存上限（按 mtime 由旧到新剪枝；本轮不是完整 LRU） */
const CACHE_MAX_BYTES = 512 * 1024 * 1024
const CACHE_PRUNE_INTERVAL_MS = 60_000
const LOG_INTERVAL_MS = 60_000

/** 正在下载的资源：同一 ID 的并发请求共享同一次下载 */
const pending = new Map<string, Promise<string>>()
const lastLoggedAt = new Map<string, number>()
let nextPruneAt = 0

/** 协议必须在 app ready 之前注册为特权协议，否则自定义协议在渲染层不可用 */
export function registerResourceScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: RESOURCE_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/** 在 app ready 之后接管协议请求 */
export function registerResourceProtocol(): void {
  protocol.handle(RESOURCE_SCHEME, (request) => handleResourceRequest(request))
}

function cacheDir(): string {
  return join(app.getPath('home'), '.vault-scrape', 'cache', 'resource')
}

function notFound(): Response {
  return new Response(null, { status: 404 })
}

function warnOnce(key: string, message: string): void {
  const now = Date.now()
  const last = lastLoggedAt.get(key) ?? 0
  if (now - last < LOG_INTERVAL_MS) return
  lastLoggedAt.set(key, now)
  appendLog({ level: 'warn', scope: 'resource', message })
}

interface ResourceTarget {
  /** 连接内绝对路径 */
  path: string
  /** 已知大小；0 表示未知（封面兜底路径推不出大小） */
  size: number
}

/** 索引表优先、结果行封面兜底 */
function resolveTarget(connectionId: string, resourceId: string): ResourceTarget | null {
  const row = getResourceById(resourceId)
  if (row && row.connectionId === connectionId) return { path: row.path, size: row.size }

  const file = findScrapeFileByCoverId(resourceId)
  if (!file || file.coverPath.length === 0) return null
  const task = getTask(file.taskId)
  if (!task || task.connectionId !== connectionId) return null
  return { path: file.coverPath, size: 0 }
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

/** 远端资源落本机缓存；同一 ID 并发只下载一次 */
async function ensureCached(
  connection: FileConnection,
  resourceId: string,
  target: ResourceTarget
): Promise<string> {
  const file = join(cacheDir(), resourceId)
  if (isCacheUsable(file, target.size)) return file
  const existing = pending.get(resourceId)
  if (existing) return existing
  const task = downloadToCache(connection, target, file).finally(() => {
    pending.delete(resourceId)
  })
  pending.set(resourceId, task)
  return task
}

async function downloadToCache(
  connection: FileConnection,
  target: ResourceTarget,
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

async function handleResourceRequest(request: Request): Promise<Response> {
  const parts = parseResourceUrl(request.url)
  if (!parts) return notFound()
  const { connectionId, resourceId } = parts
  if (!CONNECTION_ID_PATTERN.test(connectionId) || !RESOURCE_ID_PATTERN.test(resourceId)) {
    return notFound()
  }
  try {
    const connection = getConnection(connectionId)
    if (!connection) return notFound()
    const target = resolveTarget(connectionId, resourceId)
    if (!target) return notFound()
    if (connection.protocol === 'local') {
      const osPath = resolveInsideRoot(connection.rootPath, target.path)
      return await net.fetch(pathToFileURL(osPath).toString())
    }
    const cached = await ensureCached(connection, resourceId, target)
    return await net.fetch(pathToFileURL(cached).toString())
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    warnOnce(resourceId, `资源读取失败（${connectionId}/${resourceId}）：${message}`)
    return notFound()
  }
}
