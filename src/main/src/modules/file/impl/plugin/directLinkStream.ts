/**
 * 下载直链的字节流读取：存储插件的宿主侧公共能力。
 *
 * 契约：
 * 1. 插件只负责给出直链（url + 请求头），真正的 HTTP Range 请求统一在这里做——
 *    所有存储插件共用同一条字节通路，直链过期时由调用方重新 resolve；
 * 2. 跟随 301 / 302 / 307 / 308 重定向（跨协议也允许），上限 5 跳；
 *    自定义请求头（防盗链 Cookie / UA）在重定向后原样携带；
 * 3. Range 请求只接受 206；无 Range 请求接受 200。403 / 410 / 404 视为直链失效；
 * 4. 返回值是 node `IncomingMessage`（本身就是 Readable），满足 FileClient.readRange
 *    「必须返回真 node Readable、支持 destroy() 取消」的约定。
 */
import type { ClientRequest, RequestOptions } from 'node:http'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Readable } from 'node:stream'
import { FileError } from '@common/types/file'

/** 重定向跳数上限 */
const MAX_REDIRECTS = 5

const REDIRECT_STATUS = [301, 302, 307, 308]

/** 直链失效（防盗链过期 / 文件被删）对应的 HTTP 状态码 */
const EXPIRED_STATUS = new Set([403, 404, 410])

export interface DirectLinkStreamOptions {
  url: string
  headers?: Record<string, string>
  /** 闭区间字节区间（与 FileClient.readRange 同一口径）；缺省表示整文件 */
  range?: { start: number; end: number }
  timeoutMs: number
  signal?: AbortSignal
}

type OnceResult =
  | { kind: 'response'; response: Readable; statusCode: number }
  | { kind: 'redirect'; url: URL }

function requestFor(url: URL): (url: URL, options: RequestOptions) => ClientRequest {
  if (url.protocol === 'https:') return httpsRequest
  if (url.protocol === 'http:') return httpRequest
  throw new FileError('invalidArgument', `不支持的下载地址协议：${url.protocol}`)
}

/** 发起单次 GET：返回响应或下一跳地址；请求头与超时、取消都由这里负责 */
function requestOnce(
  url: URL,
  headers: Record<string, string>,
  timeoutMs: number,
  signal: AbortSignal | undefined
): Promise<OnceResult> {
  return new Promise((resolve, reject) => {
    const req = requestFor(url)(url, { method: 'GET', headers })
    let settled = false
    const fail = (error: FileError): void => {
      if (settled) return
      settled = true
      req.destroy()
      reject(error)
    }
    const done = (result: OnceResult): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    req.setTimeout(timeoutMs, () => fail(new FileError('timeout', '下载请求超时')))
    req.on('error', (error: Error) => fail(new FileError('network', `下载请求失败：${error.message}`)))
    if (signal) {
      if (signal.aborted) return fail(new FileError('cancelled'))
      signal.addEventListener(
        'abort',
        () => fail(new FileError('cancelled')),
        { once: true }
      )
    }
    req.on('response', (response) => {
      const status = response.statusCode ?? 0
      const location = response.headers.location
      if (REDIRECT_STATUS.includes(status) && typeof location === 'string' && location.length > 0) {
        response.resume()
        try {
          done({ kind: 'redirect', url: new URL(location, url) })
        } catch {
          fail(new FileError('network', '下载地址重定向不合法'))
        }
        return
      }
      done({ kind: 'response', response, statusCode: status })
    })
    req.end()
  })
}

/**
 * 打开一条直链字节流。
 *
 * 直链失效（403 / 404 / 410）抛 `notFound`，调用方应重新 resolve 拿新直链再试。
 */
export async function openDirectLinkStream(options: DirectLinkStreamOptions): Promise<Readable> {
  let target: URL
  try {
    target = new URL(options.url)
  } catch {
    throw new FileError('invalidArgument', '下载地址不是合法的 URL')
  }
  const headers: Record<string, string> = { ...(options.headers ?? {}) }
  if (options.range) {
    headers.Range = `bytes=${options.range.start}-${options.range.end}`
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const result = await requestOnce(target, headers, options.timeoutMs, options.signal)
    if (result.kind === 'redirect') {
      target = result.url
      continue
    }
    const { response, statusCode } = result
    if (EXPIRED_STATUS.has(statusCode)) {
      response.resume()
      throw new FileError('notFound', '下载地址已失效，请稍后重试')
    }
    if (statusCode === 401) {
      response.resume()
      throw new FileError('authFailed', '下载地址拒绝访问，请重新登录该存储')
    }
    if (statusCode < 200 || statusCode >= 300) {
      response.resume()
      throw new FileError('network', `下载请求失败（状态码 ${statusCode}）`)
    }
    if (options.range && statusCode !== 206) {
      response.resume()
      throw new FileError('network', '该地址不支持按区间读取')
    }
    return response
  }
  throw new FileError('network', `下载地址重定向超过 ${MAX_REDIRECTS} 次`)
}
