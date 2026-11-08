import { createReadStream } from 'fs'
import { stat as statPath } from 'fs/promises'
import { Readable } from 'node:stream'
import {
  FileError,
  basenameRemotePath,
  createFileEntry,
  dirnameRemotePath,
  joinRemotePath,
  sortFileEntries,
  splitRemotePath,
  type FileCreateOptions,
  type FileEntry,
  type FileMkdirOptions,
  type FileProtocol,
  type FileRemoveOptions,
  type OpenlistConnection
} from '@common/types/file'
import { AbstractFileClient, type FileClientOptions, type TransferOptions } from '../../FileClient'
import { isNotFoundError } from '../../fileErrorUtils'
import { copyStreamToLocalFile, withProgress } from '../../streamCopy'
import { openDirectLinkStream } from '../plugin/directLinkStream'
import { OpenlistApi, type OpenlistFsObject } from './openlistApi'

/** list 单页条数（服务端上限 100）与翻页保护，口径与插件实现一致 */
const LIST_PAGE_SIZE = 100
const LIST_PAGE_LIMIT = 200
const LIST_ENTRY_LIMIT = 50_000
/** readText 的字节上限：NFO / JSON 等小文本远小于该值 */
const READ_TEXT_LIMIT = 10 * 1024 * 1024
/** 直链缓存时长：网盘直链普遍几分钟内有效，过期自动重取 */
const LINK_TTL_MS = 5 * 60 * 1000

/** 已解析的下载直链：到期前复用，避免每次 Range 请求都打一次 OpenList */
interface ResolvedLink {
  url: string
  expiresAt: number
}

/**
 * OpenList 实现：元数据与写操作走 `/api/fs/*`，字节流由宿主拿直链自取。
 *
 * 契约：
 * - readText / readRange / download 共用 fs/get 解析出的直链这一条字节通路，
 *   直链按 path 缓存到过期；读取遇「直链失效」（403 / 404 / 410）时绕过缓存
 *   重新解析一次再试，播放中途换链无感；
 * - fs/get 返回的 `path` 是存储驱动的物理路径，FileEntry 一律用连接内的虚拟路径；
 * - OpenList 的 mkdir 只建最后一级，recursive 语义在这里逐级补齐。
 */
export class OpenlistFileClient extends AbstractFileClient {
  readonly protocol: FileProtocol = 'openlist'

  private readonly api: OpenlistApi
  /** path -> 直链缓存（连接生命周期内有效，dispose 时清空） */
  private readonly links = new Map<string, ResolvedLink>()

  constructor(connection: OpenlistConnection, token: string, options: FileClientOptions) {
    super(options)
    this.api = new OpenlistApi(connection.url, token, options.timeoutMs)
  }

  async init(): Promise<void> {
    // 用根目录的首页列表做连通性探测：一次调用同时验证「地址可达 + 令牌有效」
    await this.run(() => this.api.list('/', 1, 1).then(() => undefined), 'network', '连接 OpenList')
  }

  async dispose(): Promise<void> {
    this.links.clear()
  }

  async stat(path: string): Promise<FileEntry> {
    const remote = this.path(path)
    const info = await this.run(() => this.api.get(remote), 'notFound', '读取文件信息')
    return this.toEntry(remote, info)
  }

  async exists(path: string): Promise<boolean> {
    const remote = this.path(path)
    try {
      await this.run(() => this.api.get(remote), 'notFound', '判断文件是否存在')
      return true
    } catch (error) {
      if (isNotFoundError(error)) return false
      throw error
    }
  }

  async list(path: string): Promise<FileEntry[]> {
    const remote = this.path(path)
    const entries: FileEntry[] = []
    let page = 1
    while (true) {
      const result = await this.run(
        () => this.api.list(remote, page, LIST_PAGE_SIZE),
        'notDirectory',
        '读取目录'
      )
      for (const item of result.content) {
        if (entries.length >= LIST_ENTRY_LIMIT) break
        entries.push(this.toEntry(remote, item))
      }
      if (entries.length >= LIST_ENTRY_LIMIT) {
        console.warn(`[file] ${this.label} 目录 ${remote} 条目超过 ${LIST_ENTRY_LIMIT}，已截断`)
        break
      }
      if (result.total > 0 && entries.length >= result.total) break
      if (result.content.length < LIST_PAGE_SIZE) break
      page += 1
      if (page > LIST_PAGE_LIMIT) {
        console.warn(`[file] ${this.label} 目录 ${remote} 翻页超过 ${LIST_PAGE_LIMIT} 页，已截断`)
        break
      }
    }
    return sortFileEntries(entries)
  }

  async mkdir(path: string, options?: FileMkdirOptions): Promise<void> {
    const remote = this.path(path)
    await this.run(
      async () => {
        if (!(options?.recursive ?? true)) {
          const parent = dirnameRemotePath(remote)
          if (!(await this.exists(parent))) throw new FileError('notFound', `父目录不存在：${parent}`)
          await this.api.mkdir(remote)
          return
        }
        // OpenList 只建最后一级：逐级补齐，已存在的层级跳过
        let current = ''
        for (const segment of splitRemotePath(remote)) {
          current = `${current}/${segment}`
          if (await this.exists(current)) continue
          await this.api.mkdir(current)
        }
      },
      'permissionDenied',
      '创建文件夹'
    )
  }

  async createFile(path: string, options?: FileCreateOptions): Promise<void> {
    await this.writeText(path, '', options)
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

  async writeText(path: string, content: string, options?: FileCreateOptions): Promise<void> {
    const remote = this.path(path)
    const overwrite = options?.overwrite ?? false
    await this.run(
      async () => {
        if (!overwrite && (await this.exists(remote))) {
          throw new FileError('alreadyExists', `目标已存在：${remote}`)
        }
        const buffer = Buffer.from(content, 'utf-8')
        await this.api.put({
          path: remote,
          source: Readable.from(buffer),
          size: buffer.length,
          overwrite
        })
      },
      'permissionDenied',
      '写入文件'
    )
  }

  async move(from: string, to: string, options?: FileCreateOptions): Promise<void> {
    const source = this.path(from)
    const target = this.pathNotRoot(to, '移动文件')
    await this.run(
      async () => {
        if (!(options?.overwrite ?? false) && (await this.exists(target))) {
          throw new FileError('alreadyExists', `目标已存在：${target}`)
        }
        const parentFrom = dirnameRemotePath(source)
        const parentTo = dirnameRemotePath(target)
        const name = basenameRemotePath(target)
        if (parentFrom === parentTo) {
          await this.api.rename(source, name)
          return
        }
        if (!(await this.exists(parentTo))) {
          throw new FileError('notFound', `目标目录不存在：${parentTo}`)
        }
        await this.api.move(parentFrom, parentTo, [name])
      },
      'permissionDenied',
      '移动文件'
    )
  }

  async copy(from: string, to: string, options?: FileCreateOptions): Promise<void> {
    const source = this.path(from)
    const target = this.pathNotRoot(to, '复制文件')
    await this.run(
      async () => {
        if (!(options?.overwrite ?? false) && (await this.exists(target))) {
          throw new FileError('alreadyExists', `目标已存在：${target}`)
        }
        const parentTo = dirnameRemotePath(target)
        if (!(await this.exists(parentTo))) {
          throw new FileError('notFound', `目标目录不存在：${parentTo}`)
        }
        await this.api.copy(dirnameRemotePath(source), parentTo, [basenameRemotePath(target)])
      },
      'permissionDenied',
      '复制文件'
    )
  }

  async remove(path: string, options?: FileRemoveOptions): Promise<void> {
    const remote = this.pathNotRoot(path, '删除')
    await this.run(
      async () => {
        if (!(options?.recursive ?? true)) {
          const info = await this.api.get(remote)
          if (info.isDir && (await this.api.list(remote, 1, 1)).content.length > 0) {
            throw new FileError('notEmpty', `目录非空：${remote}`)
          }
        }
        await this.api.remove(dirnameRemotePath(remote), [basenameRemotePath(remote)])
      },
      'permissionDenied',
      '删除'
    )
  }

  async upload(localPath: string, remotePath: string, options?: TransferOptions): Promise<void> {
    const remote = this.pathNotRoot(remotePath, '上传')
    const overwrite = options?.overwrite ?? false
    if (!overwrite && (await this.exists(remote))) {
      throw new FileError('alreadyExists', `目标已存在：${remote}`)
    }
    await this.run(
      async () => {
        const info = await statPath(localPath)
        const source = withProgress(createReadStream(localPath), {
          total: info.size,
          onProgress: options?.onProgress,
          signal: options?.signal
        })
        try {
          await this.api.put({ path: remote, source, size: info.size, overwrite })
        } catch (error) {
          // 远端可能留下半截文件：失败即清理（与 WebDAV 实现同口径）
          await this.api.remove(dirnameRemotePath(remote), [basenameRemotePath(remote)]).catch(
            () => undefined
          )
          throw error
        }
      },
      'network',
      '上传文件'
    )
  }

  async download(remotePath: string, localPath: string, options?: TransferOptions): Promise<void> {
    const remote = this.path(remotePath)
    const overwrite = options?.overwrite ?? false
    if (!overwrite && (await this.localExists(localPath))) {
      throw new FileError('alreadyExists', `目标已存在：${localPath}`)
    }
    await this.run(
      async () => {
        const info = await this.api.get(remote).catch(() => null)
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

  private toEntry(parentPath: string, info: OpenlistFsObject): FileEntry {
    return createFileEntry({
      path: joinRemotePath(parentPath, info.name),
      name: info.name,
      type: info.isDir ? 'directory' : 'file',
      size: info.size,
      modifiedAt: info.modifiedAt
    })
  }

  /** 解析直链（带缓存）；force = true 时绕过缓存强制重取 */
  private async resolveLink(path: string, force: boolean): Promise<string> {
    const cached = this.links.get(path)
    if (!force && cached && cached.expiresAt > Date.now()) return cached.url
    const info = await this.run(() => this.api.get(path), 'notFound', '解析下载地址')
    const link: ResolvedLink = {
      url: this.api.downloadUrl(info.rawUrl, path, info.sign),
      expiresAt: Date.now() + LINK_TTL_MS
    }
    this.links.set(path, link)
    return link.url
  }

  private async openRange(path: string, start: number, end: number, force: boolean): Promise<Readable> {
    const url = await this.resolveLink(path, force)
    return openDirectLinkStream({ url, range: { start, end }, timeoutMs: this.timeoutMs })
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
      await statPath(localPath)
      return true
    } catch {
      return false
    }
  }
}
