/**
 * 长任务通道（窗口侧）。
 *
 * 契约：
 * - 挂载前调一次 `initJobs()` 注册常驻监听，之后所有任务结果都不会漏；
 * - `runJob()` 先等监听就绪，再调 core 的 `coreJob` 拿 jobId，最后用 jobId 匹配结果；
 * - 结果形状与直接调用完全一致（各域信封）；core 侧抛错会转成 `{ ok: false, message }`。
 */
import { listen } from '@dashou/api'
import { CORE_EVENTS } from '@common/channels'
import { callCore } from './invoke'

interface JobDonePayload {
  jobId: string
  ok: boolean
  result?: unknown
  message?: string
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

const pending = new Map<string, Pending>()
/** 结果先于 jobId 到达时的暂存（极快的任务；按插入顺序限量，避免无限增长） */
const early = new Map<string, JobDonePayload>()
let ready: Promise<void> | null = null

function settle(payload: JobDonePayload): void {
  const entry = pending.get(payload.jobId)
  if (entry) {
    pending.delete(payload.jobId)
    if (payload.ok) entry.resolve(payload.result)
    else entry.reject(new Error(payload.message || '操作失败'))
    return
  }
  early.set(payload.jobId, payload)
  if (early.size > 100) {
    const oldest = early.keys().next().value
    if (oldest !== undefined) early.delete(oldest)
  }
}

/** 应用启动时调一次；重复调用返回同一个 Promise */
export function initJobs(): Promise<void> {
  ready ??= listen<JobDonePayload>(CORE_EVENTS.jobDone, (event) => {
    if (event.payload) settle(event.payload)
  }).then(() => undefined)
  return ready
}

/** 提交一个长任务并等待结果 */
export async function runJob<T>(method: string, args?: unknown): Promise<T> {
  await initJobs()
  const { jobId } = await callCore<{ jobId: string }>('coreJob', { method, args })
  const done = early.get(jobId)
  if (done) {
    early.delete(jobId)
    if (done.ok) return done.result as T
    throw new Error(done.message || '操作失败')
  }
  return new Promise<T>((resolve, reject) => {
    pending.set(jobId, { resolve: resolve as (value: unknown) => void, reject })
  })
}
