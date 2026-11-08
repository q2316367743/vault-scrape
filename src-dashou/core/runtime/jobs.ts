/**
 * 长任务通道。
 *
 * 背景：宿主对「窗口 → core 的 API 调用」有 30 秒硬超时（能力调用同样如此），
 * 而资料库扫描、单条刮削、翻译、系统选择框等操作天然可能超过 30 秒。
 *
 * 契约：
 * 1. 长任务拆成两次调用：`coreJob({ method, args })` 立即返回 `jobId`，
 *    真正的执行在后台继续，结束后广播 `core:job:done`（`{ jobId, ok, result | message }`）；
 * 2. 窗口侧在应用启动时挂一个常驻监听，按 jobId 把结果交还给对应的 Promise；
 * 3. 任务本身不因窗口关闭而取消（扫描 / 抓取本来就该继续），进度另有各自的事件推送。
 */
import { randomUUID } from 'node:crypto'
import type { PluginContext } from '@dashou/core'
import { CORE_EVENTS } from '@common/channels'

export type JobHandler = (ctx: PluginContext, args: unknown) => Promise<unknown> | unknown

const handlers = new Map<string, JobHandler>()

export function registerJob(name: string, handler: JobHandler): void {
  handlers.set(name, handler)
}

export interface JobDonePayload {
  jobId: string
  ok: boolean
  result?: unknown
  message?: string
}

/** 启动一个长任务，立即返回 jobId */
export function startJob(
  ctx: PluginContext,
  payload: unknown
): { jobId: string } {
  const source = (payload ?? {}) as { method?: unknown; args?: unknown }
  const method = typeof source.method === 'string' ? source.method : ''
  const handler = handlers.get(method)
  if (!handler) throw new Error('未知的任务')
  const jobId = randomUUID()
  // 先让 `coreJob` 的返回值发出去，再开始跑任务：极快的任务也不会把完成事件抢在 jobId 前面
  setTimeout(() => {
    void (async () => {
      try {
        const result = await handler(ctx, source.args)
        const done: JobDonePayload = { jobId, ok: true, result }
        ctx.event.emit(CORE_EVENTS.jobDone, done)
      } catch (error) {
        const done: JobDonePayload = {
          jobId,
          ok: false,
          message: error instanceof Error ? error.message : '操作失败'
        }
        ctx.event.emit(CORE_EVENTS.jobDone, done)
      }
    })()
  }, 0)
  return { jobId }
}
