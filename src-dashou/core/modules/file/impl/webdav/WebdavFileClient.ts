import { createReadStream } from 'fs'
import { stat as statPath } from 'fs/promises'
import { Readable } from 'stream'
import { AuthType, createClient, type FileStat, type WebDAVClient } from 'webdav'
import {
  FileError,
  createFileEntry,
  sortFileEntries,
  type FileCreateOptions,
  type FileEntry,
  type FileMkdirOptions,
  type FileProtocol,
  type FileRemoveOptions,
  type WebdavAuthType,
  type WebdavConnection
} from '@common/types/file'
import { AbstractFileClient, type FileClientOptions, type TransferOptions } from '../../FileClient'
import { isNotFoundError } from '../../fileErrorUtils'
import { copyProgressSourceToLocalFile, withProgress } from '../../streamCopy'

type WebdavStatResult = Awaited<ReturnType<WebDAVClient['stat']>>

/**
 * 我们对外暴露的认证方式 → webdav 的 AuthType。
 * webdav 的 AuthType 是字符串枚举（不是字面量联合），必须用枚举成员，
 * 且库里的 Basic 认证叫 Password。
 */
const AUTH_TYPE_MAP: Readonly<Record<WebdavAuthType, AuthType>> = {
  auto: AuthType.Auto,
  basic: AuthType.Password,
  digest: AuthType.Digest,
  none: AuthType.None
}

/** stat 带不带 details 都返回联合类型，这里统一收窄成 FileStat */
function unwrapStat(info: WebdavStatResult): FileStat {
  return 'data' in info ? info.data : info
}

/** getFileContents 的返回值可能是字符串、Buffer 或带信封的对象，统一转文本 */
function toText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Buffer.isBuffer(content)) return content.toString('utf-8')
  if (content instanceof Uint8Array) return Buffer.from(content).toString('utf-8')
  if (content instanceof ArrayBuffer) return Buffer.from(content).toString('utf-8')
  return ''
}

/**
 * WebDAV 实现：基于 webdav@5。
 *
 * 注意：webdav 的 createClient 不接受 timeout 参数，超时统一由基类的 run() 兜底，
 * 但超时不会真正中断已发出的 HTTP 请求（文档已标注该限制）。
 * 流式接口（createReadStream / putFileContents）拿到的是库自己的 ReadableLike /
 * WritableLike，不满足 node 流接口，因此上传走 withProgress、下载走
 * copyProgressSourceToLocalFile（两者都接受最小结构接口）。
 */
export class WebdavFileClient extends AbstractFileClient {
  readonly protocol: FileProtocol = 'webdav'

  private readonly client: WebDAVClient

  constructor(connection: WebdavConnection, password: string, options: FileClientOptions) {
    super(options)
    this.client = createClient(connection.url, {
      username: connection.username,
      password,
      authType: AUTH_TYPE_MAP[connection.authType]
    })
  }

  async init(): Promise<void> {
    await this.run(
      () => this.client.getDirectoryContents('/').then(() => undefined),
      'network',
      '连接 WebDAV'
    )
  }

  async dispose(): Promise<void> {
    // webdav 客户端基于无状态 HTTP，无需释放
  }

  async stat(path: string): Promise<FileEntry> {
    const remote = this.path(path)
    return this.run(
      () => this.client.stat(remote, { details: true }).then((info) => this.toEntry(unwrapStat(info))),
      'notFound',
      '读取文件信息'
    )
  }

  async exists(path: string): Promise<boolean> {
    const remote = this.path(path)
    try {
      return await this.run(() => this.client.exists(remote), 'network', '判断文件是否存在')
    } catch (error) {
      if (isNotFoundError(error)) return false
      throw error
    }
  }

  async list(path: string): Promise<FileEntry[]> {
    const remote = this.path(path)
    return this.run(
      () =>
        this.client
          .getDirectoryContents(remote, { details: true })
          .then((items) => sortFileEntries(items.data.map((item) => this.toEntry(item)))),
      'notDirectory',
      '读取目录'
    )
  }

  async mkdir(path: string, options?: FileMkdirOptions): Promise<void> {
    const remote = this.path(path)
    await this.run(
      () => this.client.createDirectory(remote, { recursive: options?.recursive ?? true }),
      'permissionDenied',
      '创建文件夹'
    )
  }

  async createFile(path: string, options?: FileCreateOptions): Promise<void> {
    await this.writeText(path, '', options)
  }

  async readText(path: string): Promise<string> {
    const remote = this.path(path)
    return this.run(
      () =>
        this.client
          .getFileContents(remote, { format: 'text' })
          .then((content) => toText(content)),
      'notFound',
      '读取文件'
    )
  }

  async readRange(path: string, start: number, end: number): Promise<Readable> {
    const remote = this.path(path)
    return this.run(
      async () => {
        // range 选项会让库发出 Range 头，服务器不返回 206 时库自己抛错
        const source = await this.client.createReadStream(remote, { range: { start, end } })
        if (!(source instanceof Readable)) {
          throw new FileError('network', `WebDAV 未返回流式响应：${remote}`)
        }
        return source
      },
      'network',
      '读取文件区间'
    )
  }

  async writeText(path: string, content: string, options?: FileCreateOptions): Promise<void> {
    const remote = this.path(path)
    await this.run(
      () => this.client.putFileContents(remote, content, { overwrite: options?.overwrite ?? false }),
      'permissionDenied',
      '写入文件'
    )
  }

  async move(from: string, to: string, options?: FileCreateOptions): Promise<void> {
    const source = this.path(from)
    const target = this.pathNotRoot(to, '移动文件')
    await this.run(
      () => this.client.moveFile(source, target, { overwrite: options?.overwrite ?? false }),
      'permissionDenied',
      '移动文件'
    )
  }

  async copy(from: string, to: string, options?: FileCreateOptions): Promise<void> {
    const source = this.path(from)
    const target = this.pathNotRoot(to, '复制文件')
    await this.run(
      () => this.client.copyFile(source, target, { overwrite: options?.overwrite ?? false }),
      'permissionDenied',
      '复制文件'
    )
  }

  async remove(path: string, options?: FileRemoveOptions): Promise<void> {
    const remote = this.pathNotRoot(path, '删除')
    const recursive = options?.recursive ?? true
    await this.run(
      async () => {
        if (!recursive) {
          const info = unwrapStat(await this.client.stat(remote, { details: true }))
          if (info.type === 'directory') {
            const children = await this.client.getDirectoryContents(remote, { details: true })
            if (children.data.length > 0) throw new FileError('notEmpty', `目录非空：${remote}`)
          }
        }
        await this.client.deleteFile(remote)
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
          // putFileContents 接受 ReadableLike + contentLength，由库负责分块发送
          await this.client.putFileContents(remote, source, {
            overwrite,
            contentLength: info.size
          })
        } catch (error) {
          await this.client.deleteFile(remote).catch(() => undefined)
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
        const total = await this.client
          .stat(remote, { details: true })
          .then((info) => unwrapStat(info).size)
          .catch(() => 0)
        await copyProgressSourceToLocalFile(await this.client.createReadStream(remote), localPath, {
          total,
          onProgress: options?.onProgress,
          signal: options?.signal
        })
      },
      'network',
      '下载文件'
    )
  }

  private toEntry(info: FileStat): FileEntry {
    return createFileEntry({
      path: info.filename,
      name: info.basename,
      type: info.type === 'directory' ? 'directory' : 'file',
      size: info.size,
      modifiedAt: Date.parse(info.lastmod),
      etag: info.etag ?? '',
      mime: info.mime ?? ''
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
