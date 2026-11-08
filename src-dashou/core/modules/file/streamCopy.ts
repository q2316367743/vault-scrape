import { Transform, type TransformCallback } from 'stream'
import { createReadStream, createWriteStream } from 'fs'
import { rm } from 'fs/promises'
import { pipeline } from 'stream/promises'
import type { Readable, Writable } from 'stream'
import { toFileError } from './fileErrorUtils'

/**
 * 流式复制 + 进度回调，所有大文件传输都必须走这里，禁止整文件读入内存。
 *
 * 契约：
 * - 进度回调按 200ms 节流，并在收尾时补一次最终值；
 * - 传输中途失败或取消时清理半成品；
 * - 错误统一收敛成 FileError（取消 → cancelled，其余按底层错误映射）。
 *
 * 之所以同时存在两套入口：webdav@5 的 createReadStream 返回它自己的
 * `ReadableLike`（只有 on/once/emit/pipe/destroy），并不满足 node `Readable` 的接口，
 * 因此用一个最小结构接口 ProgressSource 兼容两者。
 */
const PROGRESS_INTERVAL_MS = 200

export interface StreamCopyOptions {
  /** 预期总字节数，0 表示未知 */
  total: number
  onProgress?: (transferred: number, total: number) => void
  signal?: AbortSignal
  /** 失败时的额外清理回调（例如删除远端半截文件） */
  cleanupTarget?: () => Promise<void>
}

/** 进度源的最小结构形状：node Readable 与 webdav ReadableLike 都满足 */
export interface ProgressSource {
  on(event: 'data', listener: (chunk: Buffer) => void): unknown
  on(event: 'end', listener: () => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
}

function createAbortError(): Error {
  const error = new Error('操作已取消')
  error.name = 'AbortError'
  return error
}

class ProgressTransform extends Transform {
  private transferred = 0
  private lastEmitAt = 0

  constructor(private readonly options: StreamCopyOptions) {
    super()
    options.signal?.addEventListener('abort', () => this.destroy(createAbortError()), { once: true })
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.transferred += chunk.length
    const now = Date.now()
    if (this.options.onProgress && now - this.lastEmitAt >= PROGRESS_INTERVAL_MS) {
      this.lastEmitAt = now
      this.options.onProgress(this.transferred, this.options.total)
    }
    callback(null, chunk)
  }

  override _flush(callback: TransformCallback): void {
    this.options.onProgress?.(this.transferred, this.options.total)
    callback()
  }
}

/** 给 node 可读流套上进度（用于需要「把流交给底层库」的场景，如 webdav 的 putFileContents） */
export function withProgress(source: Readable, options: StreamCopyOptions): Readable {
  return source.pipe(new ProgressTransform(options))
}

/** 可读流 → 可写流（本地→远端上传、远端→远端复制） */
export async function copyStreamToStream(
  source: Readable,
  target: Writable,
  options: StreamCopyOptions
): Promise<void> {
  try {
    await pipeline(source, new ProgressTransform(options), target, { signal: options.signal })
  } catch (error) {
    if (options.cleanupTarget) await options.cleanupTarget().catch(() => undefined)
    throw toFileError(error, 'network')
  }
}

/** 可读流 → 本机文件；失败时删除写了一半的本地文件 */
export async function copyStreamToLocalFile(
  source: Readable,
  targetPath: string,
  options: StreamCopyOptions
): Promise<void> {
  await copyProgressSourceToLocalFile(source, targetPath, options)
}

/** 进度源 → 本机文件；失败时删除写了一半的本地文件 */
export async function copyProgressSourceToLocalFile(
  source: ProgressSource,
  targetPath: string,
  options: StreamCopyOptions
): Promise<void> {
  const progress = new ProgressTransform(options)
  const target = createWriteStream(targetPath)
  try {
    await new Promise<void>((resolve, reject) => {
      const fail = (error: unknown): void => {
        progress.destroy()
        target.destroy()
        reject(error)
      }
      source.on('error', fail)
      progress.on('error', fail)
      target.on('error', fail)
      target.on('finish', () => resolve())
      progress.pipe(target)
      source.on('data', (chunk: Buffer) => progress.write(chunk))
      source.on('end', () => progress.end())
    })
  } catch (error) {
    await rm(targetPath, { force: true }).catch(() => undefined)
    if (options.cleanupTarget) await options.cleanupTarget().catch(() => undefined)
    throw toFileError(error, 'network')
  }
}

/** 本机文件 → 本机文件（本地实现内部的复制兜底） */
export async function copyLocalFileToLocalFile(
  sourcePath: string,
  targetPath: string,
  options: StreamCopyOptions
): Promise<void> {
  await copyStreamToLocalFile(createReadStream(sourcePath), targetPath, options)
}
