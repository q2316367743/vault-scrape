import { createReadStream, createWriteStream, type Dirent } from 'fs'
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat as statPath,
  writeFile
} from 'fs/promises'
import { join, resolve } from 'path'
import type { Readable } from 'stream'
import {
  FileError,
  createFileEntry,
  joinRemotePath,
  sortFileEntries,
  type FileCreateOptions,
  type FileEntry,
  type FileMkdirOptions,
  type FileProtocol,
  type FileRemoveOptions,
  type LocalConnection
} from '@common/types/file'
import { AbstractFileClient, type FileClientOptions, type TransferOptions } from '../../FileClient'
import { copyStreamToLocalFile, copyStreamToStream } from '../../streamCopy'
import { resolveInsideRoot } from './localPath'

/**
 * 本地磁盘实现：用 node:fs 直接读写本机目录。
 *
 * 连接内路径 → 本机绝对路径的换算与越界防护在 localPath.ts；
 * 上传的源路径、下载的目标路径是本机绝对路径，不受连接根限制。
 */
export class LocalFileClient extends AbstractFileClient {
  readonly protocol: FileProtocol = 'local'

  constructor(
    private readonly connection: LocalConnection,
    options: FileClientOptions
  ) {
    super(options)
  }

  private get localRoot(): string {
    return resolve(this.connection.rootPath)
  }

  private toLocal(remotePath: string): string {
    return resolveInsideRoot(this.localRoot, remotePath)
  }

  async init(): Promise<void> {
    await this.run(
      async () => {
        const info = await statPath(this.localRoot)
        if (!info.isDirectory()) throw new Error(`本地根目录不是一个目录：${this.localRoot}`)
      },
      'notFound',
      '打开本地目录'
    )
  }

  async dispose(): Promise<void> {
    // 本地实现没有需要释放的会话
  }

  async stat(path: string): Promise<FileEntry> {
    const remote = this.path(path)
    return this.run(
      async () => {
        const info = await statPath(this.toLocal(remote))
        return this.buildEntry(remote, info.isDirectory(), info.size, info.mtimeMs)
      },
      'notFound',
      '读取文件信息'
    )
  }

  async exists(path: string): Promise<boolean> {
    const remote = this.path(path)
    try {
      await access(this.toLocal(remote))
      return true
    } catch {
      return false
    }
  }

  async list(path: string): Promise<FileEntry[]> {
    const remote = this.path(path)
    return this.run(
      async () => {
        const target = this.toLocal(remote)
        const dirents = await readdir(target, { withFileTypes: true })
        const entries = await Promise.all(
          dirents.map((dirent) => this.entryOf(remote, target, dirent))
        )
        return sortFileEntries(entries)
      },
      'notDirectory',
      '读取目录'
    )
  }

  async mkdir(path: string, options?: FileMkdirOptions): Promise<void> {
    const remote = this.path(path)
    await this.run(
      async () => {
        await mkdir(this.toLocal(remote), { recursive: options?.recursive ?? true })
      },
      'permissionDenied',
      '创建文件夹'
    )
  }

  async createFile(path: string, options?: FileCreateOptions): Promise<void> {
    const remote = this.path(path)
    await this.writeText(remote, '', options)
  }

  async readText(path: string): Promise<string> {
    const remote = this.path(path)
    return this.run(() => readFile(this.toLocal(remote), 'utf-8'), 'notFound', '读取文件')
  }

  async readRange(path: string, start: number, end: number): Promise<Readable> {
    const remote = this.path(path)
    const local = this.toLocal(remote)
    return this.run(
      async () => {
        // 先探一次存在性，让 notFound 在流建立前就暴露，而不是变成流上的 error 事件
        await access(local)
        return createReadStream(local, { start, end })
      },
      'notFound',
      '读取文件区间'
    )
  }

  async writeText(path: string, content: string, options?: FileCreateOptions): Promise<void> {
    const remote = this.path(path)
    await this.run(
      () =>
        writeFile(this.toLocal(remote), content, {
          encoding: 'utf-8',
          flag: (options?.overwrite ?? false) ? 'w' : 'wx'
        }),
      'permissionDenied',
      '写入文件'
    )
  }

  async move(from: string, to: string, options?: FileCreateOptions): Promise<void> {
    const source = this.path(from)
    const target = this.pathNotRoot(to, '移动文件')
    if (!(options?.overwrite ?? false) && (await this.exists(target))) {
      await this.failAlreadyExists(target)
    }
    await this.run(
      () => rename(this.toLocal(source), this.toLocal(target)),
      'permissionDenied',
      '移动文件'
    )
  }

  async copy(from: string, to: string, options?: FileCreateOptions): Promise<void> {
    const source = this.path(from)
    const target = this.pathNotRoot(to, '复制文件')
    const overwrite = options?.overwrite ?? false
    await this.run(
      () =>
        cp(this.toLocal(source), this.toLocal(target), {
          recursive: true,
          force: overwrite,
          errorOnExist: !overwrite
        }),
      'permissionDenied',
      '复制文件'
    )
  }

  async remove(path: string, options?: FileRemoveOptions): Promise<void> {
    const remote = this.pathNotRoot(path, '删除')
    await this.run(
      () =>
        rm(this.toLocal(remote), {
          recursive: options?.recursive ?? true,
          force: false
        }),
      'permissionDenied',
      '删除'
    )
  }

  async upload(localPath: string, remotePath: string, options?: TransferOptions): Promise<void> {
    const remote = this.pathNotRoot(remotePath, '上传')
    const target = this.toLocal(remote)
    if (!(options?.overwrite ?? false) && (await this.exists(remote))) {
      await this.failAlreadyExists(remote)
    }
    await this.run(
      async () => {
        const info = await statPath(localPath)
        await copyStreamToStream(createReadStream(localPath), createWriteStream(target), {
          total: info.size,
          onProgress: options?.onProgress,
          signal: options?.signal,
          cleanupTarget: () => rm(target, { force: true }).then(() => undefined)
        })
      },
      'network',
      '上传文件'
    )
  }

  async download(remotePath: string, localPath: string, options?: TransferOptions): Promise<void> {
    const remote = this.path(remotePath)
    const source = this.toLocal(remote)
    if (!(options?.overwrite ?? false) && (await this.localExists(localPath))) {
      await this.failAlreadyExists(localPath)
    }
    await this.run(
      async () => {
        const info = await statPath(source)
        await copyStreamToLocalFile(createReadStream(source), localPath, {
          total: info.size,
          onProgress: options?.onProgress,
          signal: options?.signal
        })
      },
      'network',
      '下载文件'
    )
  }

  private async entryOf(parentRemote: string, target: string, dirent: Dirent): Promise<FileEntry> {
    const remote = joinRemotePath(parentRemote, dirent.name)
    if (dirent.isDirectory()) return createFileEntry({ path: remote, type: 'directory' })
    const info = await statPath(join(target, dirent.name))
    return this.buildEntry(remote, info.isDirectory(), info.size, info.mtimeMs)
  }

  private buildEntry(
    remote: string,
    isDirectory: boolean,
    size: number,
    modifiedAt: number
  ): FileEntry {
    return createFileEntry({
      path: remote,
      type: isDirectory ? 'directory' : 'file',
      size,
      modifiedAt
    })
  }

  private async localExists(localPath: string): Promise<boolean> {
    try {
      await access(localPath)
      return true
    } catch {
      return false
    }
  }

  private async failAlreadyExists(target: string): Promise<never> {
    throw new FileError('alreadyExists', `目标已存在：${target}`)
  }
}
