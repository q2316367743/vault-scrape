import { createReadStream } from 'fs'
import { stat as statPath } from 'fs/promises'
import type { Readable } from 'stream'
import { Client } from '@awo00/smb2'
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
  type FileErrorCode,
  type FileProtocol,
  type FileRemoveOptions,
  type SmbConnection
} from '@common/types/file'
import { AbstractFileClient, type FileClientOptions, type TransferOptions } from '../../FileClient'
import { copyStreamToLocalFile, copyStreamToStream } from '../../streamCopy'
import { toSmbError } from './smbErrors'

/**
 * 从包的公开导出反推内部类型（@awo00/smb2 只在入口导出 Client，不导出 Session/Tree/DirectoryEntry）。
 * 这样无需 import 协议层类型，也不必做任何 as 断言。
 */
type SmbClient = InstanceType<typeof Client>
type SmbSession = Awaited<ReturnType<SmbClient['authenticate']>>
type SmbTree = Awaited<ReturnType<SmbSession['connectTree']>>
type SmbDirectoryEntry = Awaited<ReturnType<SmbTree['readDirectory']>>[number]

/** 单次 SMB 请求的最短超时：库按块读写大文件，超时过短会被误判 */
const MIN_SMB_REQUEST_TIMEOUT_MS = 60 * 1000

/**
 * SMB 实现：基于 @awo00/smb2（纯 SMB 2.0.2 / 2.1）。
 *
 * 已知限制：不支持 SMB1 / SMB3 加密；库没有递归删除、服务端复制与 mkdir -p，
 * 这三件事在本实现里由逐项遍历完成（复制走读流→写流）。
 */
export class SmbFileClient extends AbstractFileClient {
  readonly protocol: FileProtocol = 'smb'

  private readonly client: SmbClient
  private readonly connection: SmbConnection
  private readonly password: string
  private tree: SmbTree | null = null

  constructor(connection: SmbConnection, password: string, options: FileClientOptions) {
    super(options)
    this.connection = connection
    this.password = password
    this.client = new Client(connection.host, {
      port: connection.port,
      connectTimeout: Math.max(options.timeoutMs, 10 * 1000),
      requestTimeout: Math.max(options.timeoutMs, MIN_SMB_REQUEST_TIMEOUT_MS)
    })
  }

  protected override mapError(error: unknown, fallback: FileErrorCode): FileError {
    return toSmbError(error, fallback)
  }

  async init(): Promise<void> {
    await this.run(
      async () => {
        const session = await this.client.authenticate({
          domain: this.connection.domain,
          username: this.connection.username,
          password: this.password
        })
        this.tree = await session.connectTree(this.connection.share)
      },
      'authFailed',
      '连接 SMB 共享'
    )
  }

  async dispose(): Promise<void> {
    this.tree = null
    await this.client.close().catch(() => undefined)
  }

  async stat(path: string): Promise<FileEntry> {
    const remote = this.path(path)
    return this.run(
      async () => {
        if (remote === '/') {
          return createFileEntry({ path: remote, type: 'directory' })
        }
        const entry = await this.findEntry(remote)
        if (!entry) throw new FileError('notFound', `目标不存在：${remote}`)
        return this.toEntry(remote, entry)
      },
      'notFound',
      '读取文件信息'
    )
  }

  async exists(path: string): Promise<boolean> {
    const remote = this.path(path)
    try {
      await this.stat(remote)
      return true
    } catch (error) {
      if (toSmbError(error, 'unknown').code === 'notFound') return false
      throw error
    }
  }

  async list(path: string): Promise<FileEntry[]> {
    const remote = this.path(path)
    const tree = this.requireTree()
    return this.run(
      async () => {
        const entries = await tree.readDirectory(remote)
        return sortFileEntries(entries.map((entry) => this.toEntry(remote, entry)))
      },
      'notDirectory',
      '读取目录'
    )
  }

  async mkdir(path: string, options?: FileMkdirOptions): Promise<void> {
    const remote = this.path(path)
    const tree = this.requireTree()
    const segments = splitRemotePath(remote)
    if (segments.length === 0) return
    const recursive = options?.recursive ?? true
    const targets = recursive
      ? segments.map((_segment, index) => `/${segments.slice(0, index + 1).join('/')}`)
      : [remote]
    await this.run(
      async () => {
        for (const target of targets) {
          try {
            await tree.createDirectory(target)
          } catch (error) {
            // 已存在的层级直接跳过，便于把 mkdir 当 ensure 用
            if (toSmbError(error, 'unknown').code !== 'alreadyExists') throw error
          }
        }
      },
      'permissionDenied',
      '创建文件夹'
    )
  }

  async createFile(path: string, options?: FileCreateOptions): Promise<void> {
    const remote = this.path(path)
    await this.prepareTarget(remote, options?.overwrite ?? false)
    await this.run(
      () => this.requireTree().createFile(remote).then(() => undefined),
      'permissionDenied',
      '创建文件'
    )
  }

  async readText(path: string): Promise<string> {
    const remote = this.path(path)
    return this.run(
      () => this.requireTree().readFile(remote).then((content) => content.toString('utf-8')),
      'notFound',
      '读取文件'
    )
  }

  /**
   * 按字节区间读。
   *
   * `@awo00/smb2` 原本只能从 0 顺序读整文件，本项目的 `patches/@awo00+smb2+1.1.1.patch`
   * 给 Tree.createFileReadStream 加了 `{ start, end }`（闭区间），这里直接使用；
   * 升级该依赖时必须重新生成补丁，否则类型检查会报参数不匹配。
   */
  async readRange(path: string, start: number, end: number): Promise<Readable> {
    const remote = this.path(path)
    return this.run(
      () => this.requireTree().createFileReadStream(remote, { start, end }),
      'network',
      '读取文件区间'
    )
  }

  async writeText(path: string, content: string, options?: FileCreateOptions): Promise<void> {
    const remote = this.path(path)
    await this.prepareTarget(remote, options?.overwrite ?? false)
    await this.run(
      () => this.requireTree().createFile(remote, content).then(() => undefined),
      'permissionDenied',
      '写入文件'
    )
  }

  async move(from: string, to: string, options?: FileCreateOptions): Promise<void> {
    const source = this.path(from)
    const target = this.pathNotRoot(to, '移动文件')
    const tree = this.requireTree()
    await this.run(
      async () => {
        const entry = await this.findEntry(source)
        if (!entry) throw new FileError('notFound', `目标不存在：${source}`)
        if (options?.overwrite ?? false) await this.removeIfExists(target)
        if (entry.type === 'Directory') await tree.renameDirectory(source, target)
        else await tree.renameFile(source, target)
      },
      'permissionDenied',
      '移动文件'
    )
  }

  async copy(from: string, to: string, options?: FileCreateOptions): Promise<void> {
    const source = this.path(from)
    const target = this.pathNotRoot(to, '复制文件')
    const overwrite = options?.overwrite ?? false
    await this.run(() => this.copyEntry(source, target, overwrite), 'permissionDenied', '复制文件')
  }

  async remove(path: string, options?: FileRemoveOptions): Promise<void> {
    const remote = this.pathNotRoot(path, '删除')
    const recursive = options?.recursive ?? true
    await this.run(async () => {
      const tree = this.requireTree()
      const entry = await this.findEntry(remote)
      if (!entry) throw new FileError('notFound', `目标不存在：${remote}`)
      if (entry.type === 'Directory') {
        if (recursive) {
          const children = await tree.readDirectory(remote)
          for (const child of children) {
            await this.remove(joinRemotePath(remote, child.filename), { recursive: true })
          }
        }
        await tree.removeDirectory(remote)
        return
      }
      await tree.removeFile(remote)
    }, 'permissionDenied', '删除')
  }

  async upload(localPath: string, remotePath: string, options?: TransferOptions): Promise<void> {
    const remote = this.pathNotRoot(remotePath, '上传')
    const overwrite = options?.overwrite ?? false
    if (!overwrite && (await this.exists(remote))) {
      throw new FileError('alreadyExists', `目标已存在：${remote}`)
    }
    const tree = this.requireTree()
    await this.run(
      async () => {
        const info = await statPath(localPath)
        const target = await tree.createFileWriteStream(remote)
        await copyStreamToStream(createReadStream(localPath), target, {
          total: info.size,
          onProgress: options?.onProgress,
          signal: options?.signal,
          cleanupTarget: async () => {
            await tree.removeFile(remote).catch(() => undefined)
          }
        })
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
    const tree = this.requireTree()
    await this.run(
      async () => {
        const entry = await this.findEntry(remote)
        if (!entry) throw new FileError('notFound', `目标不存在：${remote}`)
        const source = await tree.createFileReadStream(remote)
        await copyStreamToLocalFile(source, localPath, {
          total: Number(entry.fileSize),
          onProgress: options?.onProgress,
          signal: options?.signal
        })
      },
      'network',
      '下载文件'
    )
  }

  private requireTree(): SmbTree {
    if (!this.tree) throw new FileError('network', 'SMB 会话尚未初始化，请先调用 init()')
    return this.tree
  }

  /** readDirectory 拉父目录后按名字命中（库自带的 exists 对目录路径不可靠） */
  private async findEntry(remote: string): Promise<SmbDirectoryEntry | undefined> {
    const parent = dirnameRemotePath(remote)
    const name = basenameRemotePath(remote)
    const entries = await this.requireTree().readDirectory(parent)
    return entries.find((entry) => entry.filename === name)
  }

  private toEntry(parent: string, entry: SmbDirectoryEntry): FileEntry {
    return createFileEntry({
      path: joinRemotePath(parent, entry.filename),
      name: entry.filename,
      type: entry.type === 'Directory' ? 'directory' : 'file',
      size: Number(entry.fileSize),
      modifiedAt: entry.lastWriteTime.getTime(),
      etag: entry.fileId
    })
  }

  /** 建立写目标前的前置处理：overwrite 时先删旧文件，否则要求目标不存在 */
  private async prepareTarget(remote: string, overwrite: boolean): Promise<void> {
    if (overwrite) {
      await this.removeIfExists(remote)
      return
    }
    if (await this.exists(remote)) {
      throw new FileError('alreadyExists', `目标已存在：${remote}`)
    }
  }

  private async removeIfExists(remote: string): Promise<void> {
    if (await this.exists(remote)) await this.remove(remote, { recursive: true })
  }

  private async copyEntry(source: string, target: string, overwrite: boolean): Promise<void> {
    const tree = this.requireTree()
    const entry = await this.findEntry(source)
    if (!entry) throw new FileError('notFound', `目标不存在：${source}`)
    if (entry.type === 'Directory') {
      await this.mkdir(target, { recursive: true })
      const children = await tree.readDirectory(source)
      for (const child of children) {
        await this.copyEntry(joinRemotePath(source, child.filename), joinRemotePath(target, child.filename), overwrite)
      }
      return
    }
    if (overwrite) {
      await this.removeIfExists(target)
    } else if (await this.exists(target)) {
      throw new FileError('alreadyExists', `目标已存在：${target}`)
    }
    const input = await tree.createFileReadStream(source)
    const output = await tree.createFileWriteStream(target)
    await copyStreamToStream(input, output, {
      total: Number(entry.fileSize),
      cleanupTarget: async () => {
        await tree.removeFile(target).catch(() => undefined)
      }
    })
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
