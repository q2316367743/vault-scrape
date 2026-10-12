/**
 * 播放用的回环 HTTP 服务：把 `storage://` 的能力暴露成 mpv 能吃的本机地址。
 *
 * 契约：
 * - 只绑 `127.0.0.1`，且路径必须带一次性 token（`http://127.0.0.1:<port>/p/<token>/...`），
 *   等于把「按媒体 ID 读文件」的权限临时给本机播放器，token 只在进程内存里；
 * - 请求路径去掉前缀与 token 后拼回 `storage://` 交给 `handleMediaRequest`，
 *   Range 读取、播放期路径自愈、远端缓存全部复用同一套逻辑，**不在这里重写**；
 * - `HEAD` 只回响应头不读流（播放器探测用）；客户端断开（`ServerResponse` 的 `close`）时取消底层读取，
 *   否则被掐掉的 range 请求会漏一个读取流 + 文件句柄；
 * - 懒启动的应用级单例，退出前调 `disposeMediaPlayServer()`。
 */
import { randomBytes } from 'crypto'
import { once } from 'events'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { MEDIA_URL_PREFIX } from '@common/types/media'
import { appendLog } from '$/db/repo/logRepo'
import { handleMediaRequest } from './mediaProtocol'

export interface MediaPlayServer {
  /** 形如 `http://127.0.0.1:52341/p/<token>/`（末尾带斜杠） */
  baseUrl: string
  dispose(): Promise<void>
}

let running: MediaPlayServer | null = null
let pending: Promise<MediaPlayServer> | null = null

/** 懒启动的应用级单例；并发调用共享同一次启动 */
export async function startMediaPlayServer(): Promise<MediaPlayServer> {
  if (running) return running
  pending ??= launchServer()
  try {
    running = await pending
    return running
  } finally {
    pending = null
  }
}

export async function disposeMediaPlayServer(): Promise<void> {
  const server = running
  running = null
  if (server) await server.dispose()
}

async function launchServer(): Promise<MediaPlayServer> {
  const prefix = `/p/${randomBytes(16).toString('hex')}/`
  const server = createServer((request, response) => {
    void serve(prefix, request, response)
  })
  server.on('clientError', (_error, socket) => socket.destroy())

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  if (port === 0) {
    await closeServer(server)
    throw new Error('播放服务没有拿到可用端口')
  }
  appendLog({ level: 'info', scope: 'media', message: `播放服务已启动：127.0.0.1:${port}` })
  return { baseUrl: `http://127.0.0.1:${port}${prefix}`, dispose: () => closeServer(server) }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
}

async function serve(
  prefix: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (!url.pathname.startsWith(prefix)) {
    response.writeHead(404).end()
    return
  }
  const method = request.method === 'HEAD' ? 'HEAD' : 'GET'
  const range = request.headers.range
  const target = `${MEDIA_URL_PREFIX}${url.pathname.slice(prefix.length)}${url.search}`

  try {
    const media = await handleMediaRequest(
      new Request(target, { method, headers: range ? { range } : undefined })
    )
    response.writeHead(media.status, headerRecord(media.headers))
    if (method === 'HEAD' || !media.body) {
      await media.body?.cancel()
      response.end()
      return
    }
    await pipeBody(media.body, response)
    response.end()
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    if (!response.headersSent) response.writeHead(502)
    response.end()
    appendLog({ level: 'warn', scope: 'media', message: `播放服务转发失败：${message}` })
  }
}

function headerRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {}
  headers.forEach((value, key) => {
    record[key] = value
  })
  return record
}

/**
 * 手工抽流：`res` 只是普通可写流，背压交给 `drain`，客户端断开就取消读取。
 *
 * 断开信号必须听 `ServerResponse` 的 `close`：`IncomingMessage` 在「请求收完」时就 close 了
 * （GET 没有请求体，基本等于请求头一读完就触发），而这里要 `await handleMediaRequest` 之后才挂监听，
 * 挂上去时早就错过，等于没挂 —— Chromium 媒体栈缓冲够了会主动掐断 range 请求，
 * 掐断后 `write` 返回 false、`drain` 永远不来，底层读取流会被一直吊着不放（文件句柄泄漏）。
 */
async function pipeBody(body: ReadableStream<Uint8Array>, response: ServerResponse): Promise<void> {
  const reader = body.getReader()
  // 连接一断就让循环立刻醒过来（`drain` 在连接被掐之后不会再来）
  const closed = new Promise<null>((resolve) => {
    // 断开可能发生在 `handleMediaRequest` 期间（解析远端缓存能花上几秒），那时 `close` 早就发过了，
    // 只挂监听会永远等不到 —— 先用 `destroyed` 兜住这种情况，循环第一轮就退出
    if (response.destroyed) {
      resolve(null)
      return
    }
    response.once('close', () => resolve(null))
  })
  const cancel = (): void => {
    void reader.cancel().catch(() => undefined)
  }
  response.once('close', cancel)
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), closed])
      if (chunk === null || chunk.done) break
      if (!chunk.value) continue
      if (!response.write(chunk.value)) {
        await Promise.race([once(response, 'drain').catch(() => null), closed])
      }
    }
  } finally {
    response.off('close', cancel)
    reader.releaseLock()
  }
}
