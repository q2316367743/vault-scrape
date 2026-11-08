import { FileError } from '@common/types/file'

/**
 * 给任意 Promise 套一层超时保护。
 *
 * 说明：超时只让调用方立刻拿到 timeout 错误，并不会真正中断已发出的
 * HTTP / SMB 请求（底层库没有暴露中断接口），请求会在内部自然结束。
 */
export function withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return task
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new FileError('timeout', `${label} 超时（${timeoutMs} 毫秒）`))
    }, timeoutMs)
    timer.unref()
    task.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}
