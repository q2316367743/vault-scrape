/**
 * 插件运行时上下文：注入日志桥与宿主 HTTP。
 *
 * 环境变量不在这里：它由注册表读取后作为第二个参数直接传给插件方法。
 *
 * 契约：
 * 1. 插件方法签名是 `(入参, env, ctx)`，env 里的敏感值已被解密且调用前已校验必填项；
 * 2. 插件没有任何原生网络能力（沙箱不注入 fetch / require），只能走 `ctx.request`；
 * 3. `ctx.request` 统一施加网络设置的超时与重试，并按刮削节奏设置串行限速；
 * 4. 代理暂未接入：启用了代理时只写一条告警，避免用户误以为请求走了代理。
 */
import axios from 'axios'
import {
  PluginError,
  type PluginContext,
  type PluginRequestOptions,
  type PluginResponse
} from '@common/types/plugin'
import { readString, toSource } from '@common/types/setting/shared'
import { appendLog } from '$/db/repo/logRepo'
import { loadSetting } from '$/modules/setting/settingStore'
import type { PluginLogSink } from './pluginRuntime'

const RETRY_DELAY_MS = 300

/** 上一次插件请求的发起时间，用于刮削节奏限速 */
let lastRequestAt = 0

/** 代理告警每个进程只写一次 */
let proxyWarned = false

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref()
  })
}

/** 两次插件请求之间至少间隔 `scrape.requestDelay` 秒 */
async function waitRequestDelay(): Promise<void> {
  const delayMs = Math.max(0, loadSetting().scrape.requestDelay) * 1000
  const wait = lastRequestAt + delayMs - Date.now()
  if (wait > 0) await sleep(wait)
  lastRequestAt = Date.now()
}

function toHeaderRecord(headers: unknown): Record<string, string> {
  const source = toSource(headers)
  if (!source) return {}
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') result[key.toLowerCase()] = value
    else if (typeof value === 'number' || typeof value === 'boolean') {
      result[key.toLowerCase()] = String(value)
    } else if (Array.isArray(value)) {
      result[key.toLowerCase()] = value.map((item) => String(item)).join(', ')
    }
  }
  return result
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  const source = toSource(error)
  return source ? readString(source, 'message', '未知错误') : '未知错误'
}

function toRequestError(error: unknown, url: string): PluginError {
  if (error instanceof PluginError) return error
  if (axios.isAxiosError(error)) {
    const code = error.code ?? ''
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
      return new PluginError('timeout', `插件请求超时：${url}`)
    }
    return new PluginError('invokeFailed', `插件请求失败（${code || 'network'}）：${url}`)
  }
  return new PluginError('invokeFailed', `插件请求失败：${describeError(error)}（${url}）`)
}

async function requestOnce(options: PluginRequestOptions, timeoutMs: number): Promise<PluginResponse> {
  const url = typeof options.url === 'string' ? options.url.trim() : ''
  if (!/^https?:\/\//i.test(url)) {
    throw new PluginError('invalidArgument', `插件请求的 url 必须是 http(s) 地址：${url || '（空）'}`)
  }
  const method = options.method === 'POST' ? 'POST' : 'GET'
  const response = await axios.request<string>({
    url,
    method,
    headers: options.headers,
    data: method === 'POST' ? options.body : undefined,
    timeout: timeoutMs,
    responseType: 'text',
    maxRedirects: 5,
    /** 状态码交给插件自己判断，宿主只负责传输 */
    validateStatus: () => true
  })
  return {
    status: response.status,
    headers: toHeaderRecord(response.headers),
    data: typeof response.data === 'string' ? response.data : ''
  }
}

/** 宿主 HTTP：按网络设置超时 + 重试，并在每次请求前施加刮削节奏限速 */
async function hostRequest(options: PluginRequestOptions): Promise<PluginResponse> {
  const network = loadSetting().network
  const timeoutMs = Math.max(1000, options.timeout ?? network.timeout * 1000)
  const retries = Math.max(0, Math.floor(network.retryCount))
  let lastError: unknown = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    await waitRequestDelay()
    try {
      return await requestOnce(options, timeoutMs)
    } catch (error) {
      lastError = error
      if (error instanceof PluginError && error.code === 'invalidArgument') throw error
      if (attempt < retries) await sleep(RETRY_DELAY_MS)
    }
  }
  throw toRequestError(lastError, options.url)
}

/** 插件日志出口：scope 固定 `plugin:<id>`，其余交给日志表落库 */
export function createPluginLogSink(id: string): PluginLogSink {
  return (level, message, detail) => {
    appendLog({
      level,
      scope: `plugin:${id}`,
      message,
      detail: detail && detail.length > 0 ? detail : undefined
    })
  }
}

/**
 * 构造插件上下文。
 *
 * 注意：环境变量不走 `ctx`，而是作为第二个参数直接传给插件方法；
 * 调用方必须已完成必填校验（见 pluginRegistry 的 invokePlugin）。
 */
export function createPluginContext(id: string): PluginContext {
  if (!proxyWarned && loadSetting().network.proxyEnabled) {
    proxyWarned = true
    appendLog({
      level: 'warn',
      scope: `plugin:${id}`,
      message: '当前已启用代理，但插件请求暂未走代理，请留意网络连通性'
    })
  }
  return {
    request: hostRequest,
    log: createPluginLogSink(id)
  }
}
