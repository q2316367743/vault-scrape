/**
 * 时间相关的共享小工具（主进程）。
 *
 * 契约：只放与业务无关的纯函数；渲染层不要引这里（渲染层同用途的工具有 `@vueuse/core`）。
 */

/** 等待若干毫秒 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * 防抖：窗口拖动 / 缩放会连发事件，几何同步只认最后一次。
 *
 * 契约：返回的函数可重复调用，最后一次调用后 `waitMs` 才真正执行 `fn`。
 */
export function debounce(fn: () => void, waitMs: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn()
    }, waitMs)
  }
}
