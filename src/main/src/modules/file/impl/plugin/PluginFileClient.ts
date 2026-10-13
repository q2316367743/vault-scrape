import { stat } from 'fs/promises'
import { Readable } from 'node:stream'
import {
  FileError,
  createFileEntry,
  sortFileEntries,
  type FileCreateOptions,
  type FileErrorCode,
  type FileEntry,
  type FileMkdirOptions,
  type FileProtocol,
  type FileRemoveOptions,
  type PluginConnection
} from '@common/types/file'
import type {
  PluginEnvValue,
  PluginStorageEntry,
  PluginStorageListResult,
  PluginStorageResolveResult
} from '@common/types/plugin'
import { PluginError } from '@common/types/plugin'
import { AbstractFileClient, type FileClientOptions, type TransferOptions } from '../../FileClient'
import { isNotFoundError } from '../../fileErrorUtils'
import type { PluginRegistry } from '../../../plugin/pluginRegistry'
import { copyStreamToLocalFile } from '../../streamCopy'
import { openDirectLinkStream } from './directLinkStream'

/** list 单页最多 500 条（归一化层限制），游标翻页的页数上限 */
const LIST_PAGE_LIMIT = 200
/** list 全量条目上限：超大目录截断保护内存 */
const LIST_ENTRY_LIMIT = 50_000
/** readText 的字节上限：NFO / JSON 等小文本远小于该值 */
const READ_TEXT_LIMIT = 10 * 1024 * 1024
/** 直链缺省有效期（插件未声明 ttlSeconds 时），秒 */
const DEFAULT_LINK_TTL_SECONDS = 300

/** 已解析的下载直链：到期前复用，避免每次 Range 请求都打一次网盘 API */
interface ResolvedLink {
  url: string
  headers?: Record<string, string>
  expiresAt: number
}

/**
 * 存储插件实现：元数据走插件（list / stat / resolve），字节流由宿主拿直链自取。
 *
 * 契约：
 * - 第一版只读：写类操作一律抛 unsupported，刮削链路对写回失败已有容错（只记 warn 日志）；
 * - readText / readRange / download 共用 resolve 直链这一条字节通路，直链按 path
 *   缓存到过期；读取遇「直链失效」时绕过缓存重新 resolve 一次再试，播放中途换链无感；
 * - 插件不存在、被停用或加载失败都在 init 阶段暴露，错误文案直接给用户看。
 */
export class PluginFileClient extends AbstractFileClient {
  readonly protocol: FileProtocol

  private readonly pluginId: string
  private readonly registry: PluginRegistry
  private readonly env: PluginEnvValue
  /** path -> 直链缓存（连接生命周期内有效，dispose 时清空） */
  private readonly links = new Map<string, ResolvedLink>()

  constructor(
    registry: PluginRegistry,
    connection: PluginConnection,
    env: PluginEnvValue,
    options: FileClientOptions
  ) {
    super(options)
    this.registry = registry
    this.pluginId = connection.protocol
    this.protocol = connection.protocol
    this.env = env
  }

  async init(): Promise<void> {
    // 用根目录的首页列表做连通性探测：一次调用同时验证「插件可用 + 凭据有效」
    await this.guarded(() => this.pluginList('/'), 'network', '连接存储')
  }

  async dispose(): Promise<void> {
    this.links.clear()
  }

  async stat(path: string): Promise<FileEntry> {
    const remote = this.path(path)
    const entry = await this.guarded(() => this.pluginStat(remote), 'notFound', '读取文件信息')
    return this.toEntry(entry)
  }

  async exists(path: string): Promise<boolean> {
    const remote = this.path(path)
    try {
      await this.guarded(() => this.pluginStat(remote), 'notFound', '判断文件是否存在')
      return true
    } catch (error) {
      if (isNotFoundError(error)) return false
      throw error
    }
  }

  async list(path: string): Promise<FileEntry[]> {
    const remote = this.path(path)
    const entries: FileEntry[] = []
    let cursor: string | undefined
    let pages = 0
    do {
      const result = await this.guarded(
        () => this.pluginList(remote, cursor),
        'notDirectory',
        '读取目录'
      )
      for (const item of result.entries) {
        if (entries.length >= LIST_ENTRY_LIMIT) break
        entries.push(this.toEntry(item))
      }
      cursor = result.nextCursor
      pages += 1
      if (pages > LIST_PAGE_LIMIT) {
        console.warn(`[file] ${this.label} 目录 ${remote} 翻页超过 ${LIST_PAGE_LIMIT} 页，已截断`)
        break
      }
      if (entries.length >= LIST_ENTRY_LIMIT) {
        console.warn(`[file] ${this.label} 目录 ${remote} 条目超过 ${LIST_ENTRY_LIMIT}，已截断`)
        break
      }
    } while (cursor !== undefined && cursor.length > 0)
    return sortFileEntries(entries)
  }

  async readText(path: string): Promise<string> {
    const chunks: Buffer[] = []
    let received = 0
    const source = await this.readRange(path, 0, READ_TEXT_LIMIT - 1)
    for await (const chunk of source) {
      const buffer = Buffer.from(chunk as Uint8Array)
      chunks.push(buffer)
      received += buffer.length
      if (received > READ_TEXT_LIMIT) {
        source.destroy()
        throw new FileError(
          'unknown',
          `文件超过 ${Math.floor(READ_TEXT_LIMIT / 1024 / 1024)} MB，无法读取`
        )
      }
    }
    return Buffer.concat(chunks).toString('utf-8')
  }

  async readRange(path: string, start: number, end: number): Promise<Readable> {
    const remote = this.path(path)
    return this.run(
      async () => {
        try {
          return await this.openRange(remote, start, end, false)
        } catch (error) {
          // 缓存里的直链可能已失效：绕过缓存重取一次再试
          if (!isNotFoundError(error)) throw error
          return await this.openRange(remote, start, end, true)
        }
      },
      'network',
      '读取文件区间'
    )
  }

  async mkdir(_path: string, _options?: FileMkdirOptions): Promise<void> {
    throw new FileError('unsupported', '该存储暂不支持新建文件夹')
  }

  async createFile(_path: string, _options?: FileCreateOptions): Promise<void> {
    throw new FileError('unsupported', '该存储暂不支持新建文件')
  }

  async writeText(_path: string, _content: string, _options?: FileCreateOptions): Promise<void> {
    throw new FileError('unsupported', '该存储暂不支持写入')
  }

  async move(_from: string, _to: string, _options?: FileCreateOptions): Promise<void> {
    throw new FileError('unsupported', '该存储暂不支持移动')
  }

  async copy(_from: string, _to: string, _options?: FileCreateOptions): Promise<void> {
    throw new FileError('unsupported', '该存储暂不支持复制')
  }

  async remove(_path: string, _options?: FileRemoveOptions): Promise<void> {
    throw new FileError('unsupported', '该存储暂不支持删除')
  }

  async upload(_localPath: string, _remotePath: string, _options?: TransferOptions): Promise<void> {
    throw new FileError('unsupported', '该存储暂不支持上传')
  }

  async download(remotePath: string, localPath: string, options?: TransferOptions): Promise<void> {
    const remote = this.path(remotePath)
    const overwrite = options?.overwrite ?? false
    if (!overwrite && (await this.localExists(localPath))) {
      throw new FileError('alreadyExists', `目标已存在：${localPath}`)
    }
    await this.run(
      async () => {
        const info = await this.stat(remote).catch(() => null)
        const end = info !== null && info.size > 0 ? info.size - 1 : Number.MAX_SAFE_INTEGER - 1
        const source = await this.openFull(remote, end)
        await copyStreamToLocalFile(source, localPath, {
          total: info?.size ?? 0,
          onProgress: options?.onProgress,
          signal: options?.signal
        })
      },
      'network',
      '下载文件'
    )
  }

  /** 插件抛错按 PluginError 的错误码映射，其余走基类兜底 */
  protected override mapError(error: unknown, fallback: FileErrorCode): FileError {
    if (error instanceof PluginError) {
      const mapped = this.mapPluginCode(error.code, fallback)
      return new FileError(mapped, error.message.length > 0 ? error.message : undefined)
    }
    return super.mapError(error, fallback)
  }

  private mapPluginCode(code: PluginError['code'], fallback: FileErrorCode): FileErrorCode {
    if (code === 'notFound' || code === 'timeout' || code === 'invalidArgument') return code
    if (code === 'envMissing') return 'authFailed'
    return fallback
  }

  /** 统一的插件调用外壳：超时与错误收敛交给 registry 与 mapError */
  private async guarded<T>(task: () => Promise<T>, fallback: FileErrorCode, label: string): Promise<T> {
    try {
      return await task()
    } catch (error) {
      // 与基类 run 同一口径：先映射再标注来源，文案给用户看
      throw this.annotate(this.mapError(error, fallback), label)
    }
  }

  private annotate(error: FileError, label: string): FileError {
    return new FileError(error.code, `${label}失败：${error.message}`)
  }

  private pluginList(path: string, cursor?: string): Promise<PluginStorageListResult> {
    return this.registry.invokeStorageMethod(
      this.pluginId,
      'list',
      cursor === undefined ? { path } : { path, cursor },
      this.env
    )
  }

  private pluginStat(path: string): Promise<PluginStorageEntry> {
    return this.registry.invokeStorageMethod(this.pluginId, 'stat', { path }, this.env)
  }

  private pluginResolve(path: string): Promise<PluginStorageResolveResult> {
    return this.registry.invokeStorageMethod(this.pluginId, 'resolve', { path }, this.env)
  }

  private toEntry(entry: PluginStorageEntry): FileEntry {
    return createFileEntry({
      path: entry.path,
      name: entry.name.length > 0 ? entry.name : undefined,
      type: entry.type,
      size: entry.size,
      modifiedAt: entry.modifiedAt
    })
  }

  /** 解析直链（带缓存）；force = true 时绕过缓存强制重取 */
  private async resolveLink(path: string, force: boolean): Promise<ResolvedLink> {
    const cached = this.links.get(path)
    if (!force && cached && cached.expiresAt > Date.now()) return cached
    const resolved = await this.guarded(() => this.pluginResolve(path), 'notFound', '解析下载地址')
    const link: ResolvedLink = {
      url: resolved.url,
      headers: resolved.headers,
      expiresAt: Date.now() + (resolved.ttlSeconds ?? DEFAULT_LINK_TTL_SECONDS) * 1000
    }
    this.links.set(path, link)
    return link
  }

  private async openRange(path: string, start: number, end: number, force: boolean): Promise<Readable> {
    const link = await this.resolveLink(path, force)
    return openDirectLinkStream({
      url: link.url,
      headers: link.headers,
      range: { start, end },
      timeoutMs: this.timeoutMs
    })
  }

  /** 整文件直链流（download 用）：区间终点已知时用文件尾，未知时给到最大值 */
  private async openFull(path: string, end: number): Promise<Readable> {
    try {
      return await this.openRange(path, 0, end, false)
    } catch (error) {
      if (!isNotFoundError(error)) throw error
      return await this.openRange(path, 0, end, true)
    }
  }

  private async localExists(localPath: string): Promise<boolean> {
    try {
      await stat(localPath)
      return true
    } catch {
      return false
    }
  }
}
