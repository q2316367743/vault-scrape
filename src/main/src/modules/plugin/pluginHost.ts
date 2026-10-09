/**
 * 插件运行时上下文：注入日志桥与宿主 HTTP。
 *
 * 环境变量不在这里：它由注册表读取后作为第二个参数直接传给插件方法。
 *
 * 契约：
 * 1. 插件方法签名是 `(入参, env, ctx)`，env 里的敏感值已被解密且调用前已校验必填项；
 * 2. 插件没有任何原生网络能力（沙箱不注入 fetch / require），只能走 `ctx.request`；
 * 3. `ctx.request` 统一施加网络设置的超时与重试，并按刮削节奏设置串行限速；
 * 4. 代理由 `$/modules/http/httpClient` 的拦截器按最新设置注入（socket5 回落直连并告警）；
 * 5. 正文按响应声明的字符集解码（响应头 charset → `<meta>` 声明 → UTF-8 兜底），
 *    避免 axios 默认的 UTF-8 硬解把 euc-jp / shift_jis 站点的日文变成不可逆的乱码。
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
import { httpClient } from '$/modules/http/httpClient'
import { loadSetting } from '$/modules/setting/settingStore'
import type { PluginLogSink } from './pluginRuntime'

const RETRY_DELAY_MS = 300

/** 上一次插件请求的发起时间，用于刮削节奏限速 */
let lastRequestAt = 0

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

/** 嗅探字符集时最多检查的字节数：meta 声明出现在正文头部，给它足够余量 */
const CHARSET_SNIFF_BYTES = 65536

/**
 * 服务端只在 HTML 里用 `<meta>` 声明字符集的两种写法。
 * 必须锚定 `<meta>`：`<script charset="utf-8">` 这类属性不代表页面编码。
 */
const META_CHARSET_PATTERNS: readonly RegExp[] = [
  /<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9_-]+)/i,
  /<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([a-z0-9_-]+)/i
]

/** 取 Content-Type 响应头里的 charset；没写返回空串 */
function readHeaderCharset(headers: Record<string, unknown>): string {
  const raw = headers['content-type']
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return ''
  const matched = /charset\s*=\s*["']?\s*([a-z0-9_-]+)/i.exec(value)
  return matched ? matched[1] : ''
}

/** 响应头没写 charset 时，到正文头部找 `<meta>` 声明（不少日文老站只写在 meta 里） */
function sniffCharset(bytes: Uint8Array): string {
  const head = bytes.subarray(0, CHARSET_SNIFF_BYTES)
  let ascii = ''
  for (let index = 0; index < head.length; index += 1) {
    ascii += head[index] < 0x80 ? String.fromCharCode(head[index]) : ' '
  }
  for (const pattern of META_CHARSET_PATTERNS) {
    const matched = pattern.exec(ascii)
    if (matched) return matched[1]
  }
  return ''
}

function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return null
}

/**
 * 原始响应字节 → 字符串。
 *
 * axios 默认固定按 UTF-8 解码正文，遇到 euc-jp / shift_jis 的站点会把日文变成不可逆的 U+FFFD；
 * 这里改为自己拿字节，先看响应头、再看 meta 声明，最后才回落 UTF-8，让插件拿到的就是正确文本。
 */
function decodeResponseText(data: unknown, headers: Record<string, unknown>): string {
  if (typeof data === 'string') return data
  const bytes = toBytes(data)
  if (!bytes) return ''
  const charset = readHeaderCharset(headers) || sniffCharset(bytes)
  if (charset) {
    try {
      return new TextDecoder(charset).decode(bytes)
    } catch {
      /** 未知字符集标签：回落 UTF-8，是否可用交给插件判断 */
    }
  }
  return new TextDecoder('utf-8').decode(bytes)
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

async function requestOnce(
  options: PluginRequestOptions,
  timeoutMs: number
): Promise<PluginResponse> {
  const url = typeof options.url === 'string' ? options.url.trim() : ''
  if (!/^https?:\/\//i.test(url)) {
    throw new PluginError(
      'invalidArgument',
      `插件请求的 url 必须是 http(s) 地址：${url || '（空）'}`
    )
  }
  const method = options.method === 'POST' ? 'POST' : 'GET'
  /** 经共享实例发出：代理与超时兜底由 httpClient 的请求拦截器统一施加 */
  const response = await httpClient.request<ArrayBuffer>({
    url,
    method,
    headers: options.headers,
    data: method === 'POST' ? options.body : undefined,
    timeout: timeoutMs,
    /** 先取原始字节，再按响应声明的字符集解码（axios 默认只认 UTF-8，会把 euc-jp 站点读成乱码） */
    responseType: 'arraybuffer',
    maxRedirects: 5,
    /** 状态码交给插件自己判断，宿主只负责传输 */
    validateStatus: () => true
  })
  const headers = toHeaderRecord(response.headers)
  return {
    status: response.status,
    headers,
    data: decodeResponseText(response.data, headers)
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
  return {
    request: hostRequest,
    log: createPluginLogSink(id)
  }
}
