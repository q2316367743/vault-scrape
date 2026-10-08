/**
 * 文件客户端管理器：按连接 id 缓存实现类实例。
 *
 * 契约：
 * 1. 缓存的是 **Promise**，并发取同一个连接不会重复建连；
 * 2. 初始化失败不留坏缓存；
 * 3. 连接配置变更 / 删除后必须 `invalidateFileClient`，退出前 `disposeFileClients`。
 */
import {
  describeConnection,
  describeFileError,
  FileError,
  type ConnectionTestResult,
  type FileConnection,
  type FileConnectionDraft
} from '@common/types/file'
import type { FileClient, FileClientOptions } from './FileClient'
import { buildConnectionFromDraft, getConnection, loadConnectionPassword } from './fileConnectionStore'
import { LocalFileClient } from './impl/local/LocalFileClient'
import { SmbFileClient } from './impl/smb/SmbFileClient'
import { WebdavFileClient } from './impl/webdav/WebdavFileClient'
import { loadSetting } from '../setting/settingStore'

const DEFAULT_TIMEOUT_MS = 30 * 1000

const clients = new Map<string, Promise<FileClient>>()

/** 单次操作超时：取设置项的秒数；非法值回落 30 秒 */
function resolveTimeoutMs(): number {
  const seconds = loadSetting().network.timeout
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_TIMEOUT_MS
}

function createClient(connection: FileConnection, password: string): FileClient {
  const options: FileClientOptions = {
    connectionId: connection.id,
    label: describeConnection(connection),
    timeoutMs: resolveTimeoutMs()
  }
  if (connection.protocol === 'local') return new LocalFileClient(connection, options)
  if (connection.protocol === 'webdav') return new WebdavFileClient(connection, password, options)
  return new SmbFileClient(connection, password, options)
}

export function getFileClient(connectionId: string): Promise<FileClient> {
  const cached = clients.get(connectionId)
  if (cached) return cached
  const connection = getConnection(connectionId)
  if (!connection) {
    return Promise.reject(new FileError('notFound', `连接不存在：${connectionId}`))
  }
  const created = (async (): Promise<FileClient> => {
    const client = createClient(connection, loadConnectionPassword(connectionId))
    await client.init()
    return client
  })()
  // 建连失败时清掉缓存，下一次调用会重新尝试
  created.catch(() => clients.delete(connectionId))
  clients.set(connectionId, created)
  return created
}

export async function invalidateFileClient(connectionId: string): Promise<void> {
  const cached = clients.get(connectionId)
  clients.delete(connectionId)
  if (!cached) return
  await cached.then((client) => client.dispose()).catch(() => undefined)
}

export async function disposeFileClients(): Promise<void> {
  const pending = [...clients.values()]
  clients.clear()
  await Promise.all(
    pending.map((item) => item.then((client) => client.dispose()).catch(() => undefined))
  )
}

type DraftClientResult =
  | { ok: true; client: FileClient; label: string }
  | { ok: false; message: string }

/** 草稿可能不合法（缺名称 / URL 非法 / 密码解不开），这里统一收敛成结果对象 */
function prepareDraftClient(draft: FileConnectionDraft): DraftClientResult {
  try {
    const { connection, password } = buildConnectionFromDraft(draft)
    return { ok: true, client: createClient(connection, password), label: describeConnection(connection) }
  } catch (error) {
    return { ok: false, message: describeFileError(error).message }
  }
}

/** 测试连接：临时建连后立即释放，永不抛错 */
export async function testFileConnection(draft: FileConnectionDraft): Promise<ConnectionTestResult> {
  const prepared = prepareDraftClient(draft)
  if (!prepared.ok) return { ok: false, message: prepared.message }
  try {
    await prepared.client.init()
    return { ok: true, message: `连接成功：${prepared.label}` }
  } catch (error) {
    return { ok: false, message: describeFileError(error).message }
  } finally {
    await prepared.client.dispose().catch(() => undefined)
  }
}
