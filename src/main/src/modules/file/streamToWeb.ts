/**
 * 把 node 的 `Readable` 适配成 `Response` 能接受的 `ReadableStream`。
 *
 * 为什么不用 `Readable.toWeb`：主进程类型里同时存在 DOM 与 `stream/web` 两套
 * `ReadableStream` 声明，`toWeb` 返回的是 `stream/web` 那一份，`new Response(...)` 只认
 * DOM 那一份，两者在 `pipeThrough` 的泛型上判定不兼容（会直接报 TS2345），
 * 所以这里手写一个极小的适配器，不引入断言。
 *
 * 契约：
 * - 下游取消（`cancel`）与源流出错（`error`）都会 `destroy()` 源流，不漏句柄；
 * - 用 `pause()` / `resume()` 做背压：队列积压时暂停源流，`pull` 时再恢复，
 *   保证不会一口气把整个视频读进内存。
 */
import type { Readable } from 'stream'

export function toWebStream(source: Readable): ReadableStream<Uint8Array> {
  let done = false
  return new ReadableStream<Uint8Array>({
    start(controller) {
      source.on('data', (chunk: Buffer) => {
        if (done) return
        controller.enqueue(chunk)
        if ((controller.desiredSize ?? 0) <= 0) source.pause()
      })
      source.on('end', () => {
        if (done) return
        done = true
        controller.close()
      })
      source.on('error', (error: Error) => {
        if (done) return
        done = true
        controller.error(error)
      })
    },
    pull() {
      source.resume()
    },
    cancel() {
      done = true
      source.destroy()
    }
  })
}
