/**
 * core 与宿主之间的唯一出口。
 *
 * 契约：
 * - 只有 `onReady` 里调一次 `setHost(ctx)`；其余模块通过 `host()` 拿 ctx；
 * - 事件转发、窗口创建、系统对话框都从这里过，避免业务模块各自持有 ctx；
 * - 没有初始化就调用（例如对象形式的 definePluginApi 顶层副作用）会直接抛错，
 *   保证启动顺序问题在开发期就暴露。
 */
import type { PluginContext } from '@dashou/core'

let context: PluginContext | null = null

export function setHost(ctx: PluginContext): void {
  context = ctx
}

export function host(): PluginContext {
  if (!context) throw new Error('插件上下文尚未就绪')
  return context
}

/** 广播给插件所有窗口 */
export function emit(name: string, payload?: unknown): void {
  context?.event.emit(name, payload)
}

/** 定向发给某个窗口 */
export function emitTo(label: string, name: string, payload?: unknown): void {
  context?.event.emitTo(label, name, payload)
}

/** 落宿主日志（同时保留在本插件日志表的能力由调用方决定） */
export function log(message: string, level: 'debug' | 'info' | 'warn' | 'error' = 'info'): void {
  context?.log(message, level)
}
