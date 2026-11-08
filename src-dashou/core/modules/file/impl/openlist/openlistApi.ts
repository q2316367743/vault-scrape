/**
 * OpenList 的 HTTP API 封装：请求、信封解析与错误映射。
 *
 * 契约（与官方文档 https://fox.oplist.org/llms.txt 一致）：
 * - 业务接口一律 POST `{base}/api/fs/*`，请求与响应都是 JSON；
 * - 响应信封 `{ code, message, data }`，code 200 为成功；
 * - 认证头 `Authorization: <token>`，不带 Bearer 前缀；
 * - 找不到对象时服务端可能回 code 500 + "object not found"（而非 404），这里统一归一成 notFound；
 * - 用户可见文案只写结论，服务端原始 message 走日志。
 */
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { Readable } from 'node:stream'
import { FileError } from '@common/types/file'
import { readBoolean, readNumber, readString, toSource } from '@common/types/setting/shared'

/** fs/list / fs/get 返回的文件对象（只取我们用得到的字段） */
export interface OpenlistFsObject {
  name: string
  size: number
  isDir: boolean
  /** 毫秒时间戳，解析失败为 0 */
  modifiedAt: number
  /** 下载鉴权签名（开启「签名所有」时非空） */
  sign: string
  /** 下载直链；可能为空，为空时用 `/d` 路由拼 */
  rawUrl: string
}

export interface OpenlistListPage {
  content: OpenlistFsObject[]
  total: number
}

export interface OpenlistPutOptions {
  /** 连接内绝对路径 */
  path: string
  /** 文件字节流 */
  source: Readable
  /** 字节数，作为 Content-Length */
  size: number
  overwrite: boolean
}

function requestFor(url: URL): (url: URL, options: RequestOptions) => ClientRequest {
  if (url.protocol === 'https:') return httpsRequest
  if (url.protocol === 'http:') return httpRequest
  throw new FileError('invalidArgument', `不支持的 OpenList 地址协议：${url.protocol}`)
}

/** 毫秒时间戳解析；兼容 `2024-01-02 15:04:05` 这类空格分隔格式，失败为 0 */
function parseTime(value: string): number {
  if (value.length === 0) return 0
  const time = Date.parse(value.includes(' ') ? value.replace(' ', 'T') : value)
  return Number.isFinite(time) ? time : 0
}

function toFsObject(source: unknown): OpenlistFsObject | null {
  const record = toSource(source)
  if (!record) return null
  const name = readString(record, 'name', '')
  if (name.length === 0) return null
  return {
    name,
    size: readNumber(record, 'size', 0, 0),
    isDir: readBoolean(record, 'is_dir', false),
    modifiedAt: parseTime(readString(record, 'modified', '')),
    sign: readString(record, 'sign', ''),
    rawUrl: readString(record, 'raw_url', '')
  }
}

/** OpenList 找不到对象时回 code 500 + 该文案，而非 404 */
const NOT_FOUND_PATTERN = /object not found/i

/** 信封错误 → FileError；服务端原始 message 只进日志 */
function envelopeError(code: number, message: string): FileError {
  if (code === 401) return new FileError('authFailed', '令牌无效或已过期，请重新填写令牌')
  if (code === 403) return new FileError('permissionDenied', '没有访问权限，请检查 OpenList 的账号权限或目录密码')
  if (code === 404 || NOT_FOUND_PATTERN.test(message)) return new FileError('notFound')
  if (code === 400) return new FileError('invalidArgument', '请求参数不被 OpenList 接受')
  if (message.length > 0) console.warn(`[file] OpenList 响应错误（code=${code}）：${message}`)
  return new FileError('network', 'OpenList 处理请求失败，请稍后重试')
}

/** 逐段编码路径，保留斜杠，用于拼 `/d` 下载路由 */
function encodeRemotePath(path: string): string {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/')
}

/** 发起单次请求并收完响应体；超时、网络错误都在这里收敛成 FileError */
function requestOnce(
  url: URL,
  method: 'POST' | 'PUT',
  headers: Record<string, string>,
  payload: string | null,
  body: Readable | null,
  timeoutMs: number
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = requestFor(url)(url, { method, headers })
    let settled = false
    const fail = (error: FileError): void => {
      if (settled) return
      settled = true
      req.destroy()
      reject(error)
    }
    const done = (result: { status: number; text: string }): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    req.setTimeout(timeoutMs, () => fail(new FileError('timeout', 'OpenList 请求超时')))
    req.on('error', (error: Error) => fail(new FileError('network', `无法连接 OpenList：${error.message}`)))
    req.on('response', (response: IncomingMessage) => {
      const status = response.statusCode ?? 0
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('error', () => fail(new FileError('network', 'OpenList 响应读取失败')))
      response.on('end', () => done({ status, text: Buffer.concat(chunks).toString('utf-8') }))
    })
    if (body !== null) body.pipe(req)
    else req.end(payload)
  })
}

/** 解析响应体为信封；解析失败返回 null（由调用方按 HTTP 状态兜底） */
function toEnvelope(text: string): { code: number; message: string; data: unknown } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  const record = toSource(parsed)
  if (!record) return null
  const code = record.code
  return {
    code: typeof code === 'number' ? code : 0,
    message: readString(record, 'message', ''),
    data: record.data
  }
}

/** OpenList API 客户端：一个连接一个实例，方法与 `/api/fs/*` 一一对应 */
export class OpenlistApi {
  private readonly base: string
  private readonly origin: string

  constructor(baseUrl: string, private readonly token: string, private readonly timeoutMs: number) {
    this.base = baseUrl.replace(/\/+$/, '')
    this.origin = new URL(this.base).origin
  }

  /** 列目录（单页） */
  async list(path: string, page: number, perPage: number): Promise<OpenlistListPage> {
    const data = toSource(await this.post('fs/list', { path, page, per_page: perPage }))
    const raw = Array.isArray(data?.content) ? data.content : []
    const content = raw
      .map(toFsObject)
      .filter((item): item is OpenlistFsObject => item !== null)
    return { content, total: data ? readNumber(data, 'total', 0, 0) : 0 }
  }

  /** 文件 / 目录信息（含直链与签名） */
  async get(path: string): Promise<OpenlistFsObject> {
    const data = await this.post('fs/get', { path })
    const info = toFsObject(data)
    if (!info) throw new FileError('notFound', '目标不存在，可能已被移动或删除')
    return info
  }

  /** 只建最后一级目录，父目录不存在时报错（递归语义由调用方逐级实现） */
  async mkdir(path: string): Promise<void> {
    await this.post('fs/mkdir', { path })
  }

  async rename(path: string, name: string): Promise<void> {
    await this.post('fs/rename', { path, name })
  }

  async remove(dir: string, names: string[]): Promise<void> {
    await this.post('fs/remove', { dir, names })
  }

  async copy(srcDir: string, dstDir: string, names: string[]): Promise<void> {
    // As-Task: false 请求同步执行；旧版服务端忽略该头时回退为后台任务
    await this.post('fs/copy', { src_dir: srcDir, dst_dir: dstDir, names }, { 'As-Task': 'false' })
  }

  async move(srcDir: string, dstDir: string, names: string[]): Promise<void> {
    await this.post('fs/move', { src_dir: srcDir, dst_dir: dstDir, names }, { 'As-Task': 'false' })
  }

  /** 流式上传：文件字节流走 PUT 请求体，`File-Path` 头携带 URL 编码后的完整路径 */
  async put(options: OpenlistPutOptions): Promise<void> {
    const url = new URL(`${this.base}/api/fs/put`)
    const { status, text } = await requestOnce(
      url,
      'PUT',
      {
        Authorization: this.token,
        'File-Path': encodeURIComponent(options.path),
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(options.size),
        'As-Task': 'false',
        Overwrite: options.overwrite ? 'true' : 'false'
      },
      null,
      options.source,
      this.timeoutMs
    )
    this.assertEnvelope(status, text)
  }

  /** 下载直链：优先用 fs/get 给出的 raw_url（可能是站内相对路径），为空时拼 `/d` 路由 */
  downloadUrl(rawUrl: string, path: string, sign: string): string {
    if (rawUrl.length > 0) {
      return /^https?:\/\//i.test(rawUrl) ? rawUrl : `${this.origin}${rawUrl}`
    }
    const signPart = sign.length > 0 ? `?sign=${encodeURIComponent(sign)}` : ''
    return `${this.origin}/d${encodeRemotePath(path)}${signPart}`
  }

  private async post(
    pathname: string,
    body: Record<string, unknown>,
    extraHeaders?: Record<string, string>
  ): Promise<unknown> {
    const url = new URL(`${this.base}/api/${pathname}`)
    const payload = JSON.stringify(body)
    const { status, text } = await requestOnce(
      url,
      'POST',
      {
        Authorization: this.token,
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(payload)),
        ...extraHeaders
      },
      payload,
      null,
      this.timeoutMs
    )
    return this.assertEnvelope(status, text)
  }

  /** code 200 返回 data；信封解析失败时按 HTTP 状态码兜底 */
  private assertEnvelope(status: number, text: string): unknown {
    const envelope = toEnvelope(text)
    if (envelope === null) {
      if (status === 401) throw new FileError('authFailed', '令牌无效或已过期，请重新填写令牌')
      if (status === 404) throw new FileError('notFound')
      if (status < 200 || status >= 300) {
        throw new FileError('network', `OpenList 响应异常（状态码 ${status}）`)
      }
      return null
    }
    if (envelope.code !== 200) throw envelopeError(envelope.code, envelope.message)
    return envelope.data
  }
}
