/**
 * core → 窗口事件的订阅薄封装。
 *
 * `@dashou/api` 的 `listen` 是异步的，而页面侧习惯「订阅立即返回取消函数」，
 * 这里用一个小闭包抹平：登记完成前取消也会在登记后立刻退订。
 */
import { listen, type UnlistenFn } from '@dashou/api'

export function subscribe<T>(name: string, handler: (payload: T) => void): () => void {
  let unlisten: UnlistenFn | null = null
  let closed = false
  void listen<T>(name, (event) => handler(event.payload)).then((fn) => {
    if (closed) fn()
    else unlisten = fn
  })
  return () => {
    closed = true
    unlisten?.()
    unlisten = null
  }
}
