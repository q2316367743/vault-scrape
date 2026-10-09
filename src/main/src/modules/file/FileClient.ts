import type { Readable } from 'stream'
import {
  FILE_ROOT,
  FileError,
  normalizeRemotePath,
  type FileCreateOptions,
  type FileEntry,
  type FileErrorCode,
  type FileMkdirOptions,
  type FileProtocol,
  type FileRemoveOptions
} from '@common/types/file'
import { toFileError } from './fileErrorUtils'
import { withTimeout } from './withTimeout'

/**
 * 文件模块的唯一接口：一个接口 + 多个实现类（本地 / WebDAV / SMB）。
 *
 * 统一语义（三种实现必须一致）：
 * - 路径先过 normalizeRemotePath，`/` 与 `''` 均表示连接根，禁止对根目录做删除；
 * - overwrite 默认 false，目标已存在时抛 alreadyExists；
 * - mkdir 的 recursive 默认 true，remove 的 recursive 默认 true；
 * - move / copy 仅限同一连接内，目标父目录不存在时抛 notFound（不自动建父目录）。
 */
export interface TransferOptions {
  overwrite?: boolean
  /** 进度回调，实现层已按 200ms 节流 */
  onProgress?: (transferred: number, total: number) => void
  signal?: AbortSignal
}

export interface FileClient {
  readonly protocol: FileProtocol
  init(): Promise<void>
  dispose(): Promise<void>
  /** 基础信息 */
  stat(path: string): Promise<FileEntry>
  exists(path: string): Promise<boolean>
  /** 文件列表 */
  list(path: string): Promise<FileEntry[]>
  /** 创建文件夹 */
  mkdir(path: string, options?: FileMkdirOptions): Promise<void>
  /** 创建文件 */
  createFile(path: string, options?: FileCreateOptions): Promise<void>
  /** 读文本（NFO / JSON 等小文件），免落临时文件 */
  readText(path: string): Promise<string>
  /**
   * 按字节区间读（闭区间，start / end 均含），用于 `storage://` 的媒体流式播放。
   *
   * 约定：三种实现都必须返回真正的 node `Readable`（可被 `Readable.toWeb` 转换、
   * 也支持 `destroy()` 取消），不得返回协议私有的 ReadableLike。
   * 调用方负责保证 `0 <= start <= end`，实现按文件实际大小兜底。
   */
  readRange(path: string, start: number, end: number): Promise<Readable>
  writeText(path: string, content: string, options?: FileCreateOptions): Promise<void>
  /** 移动 / 复制 */
  move(from: string, to: string, options?: FileCreateOptions): Promise<void>
  copy(from: string, to: string, options?: FileCreateOptions): Promise<void>
  remove(path: string, options?: FileRemoveOptions): Promise<void>
  /** 上传：本机绝对路径 → 连接内路径 */
  upload(localPath: string, remotePath: string, options?: TransferOptions): Promise<void>
  /** 下载：连接内路径 → 本机绝对路径 */
  download(remotePath: string, localPath: string, options?: TransferOptions): Promise<void>
}

export interface FileClientOptions {
  connectionId: string
  /** 连接名，用于日志与错误文案 */
  label: string
  /** 单次操作超时（毫秒），来自设置里的 network.timeout */
  timeoutMs: number
}

/** 抽掉三种实现共用的部分：路径归一化、根目录保护、超时与错误映射 */
export abstract class AbstractFileClient implements FileClient {
  abstract readonly protocol: FileProtocol

  protected constructor(protected readonly options: FileClientOptions) {}

  abstract init(): Promise<void>
  abstract dispose(): Promise<void>
  abstract stat(path: string): Promise<FileEntry>
  abstract exists(path: string): Promise<boolean>
  abstract list(path: string): Promise<FileEntry[]>
  abstract mkdir(path: string, options?: FileMkdirOptions): Promise<void>
  abstract createFile(path: string, options?: FileCreateOptions): Promise<void>
  abstract readText(path: string): Promise<string>
  abstract readRange(path: string, start: number, end: number): Promise<Readable>
  abstract writeText(path: string, content: string, options?: FileCreateOptions): Promise<void>
  abstract move(from: string, to: string, options?: FileCreateOptions): Promise<void>
  abstract copy(from: string, to: string, options?: FileCreateOptions): Promise<void>
  abstract remove(path: string, options?: FileRemoveOptions): Promise<void>
  abstract upload(localPath: string, remotePath: string, options?: TransferOptions): Promise<void>
  abstract download(remotePath: string, localPath: string, options?: TransferOptions): Promise<void>

  protected get label(): string {
    return this.options.label
  }

  protected get timeoutMs(): number {
    return this.options.timeoutMs
  }

  /** 归一化路径并留出空值语义（'' 与 '/' 都是连接根） */
  protected path(value: string): string {
    return normalizeRemotePath(value)
  }

  /** 删除一类破坏性操作不允许作用于连接根 */
  protected pathNotRoot(value: string, action: string): string {
    const normalized = normalizeRemotePath(value)
    if (normalized === FILE_ROOT) {
      throw new FileError('invalidPath', `${action}不允许作用于连接根目录`)
    }
    return normalized
  }

  /** 实现类可覆写以接入协议私有错误码（如 SMB 的 NT 状态码） */
  protected mapError(error: unknown, fallback: FileErrorCode): FileError {
    return toFileError(error, fallback)
  }

  /** 统一的执行外壳：超时 + 错误收敛 */
  protected async run<T>(
    task: () => Promise<T>,
    fallback: FileErrorCode,
    label: string
  ): Promise<T> {
    try {
      return await withTimeout(task(), this.timeoutMs, `${this.label} ${label}`)
    } catch (error) {
      throw this.mapError(error, fallback)
    }
  }
}
