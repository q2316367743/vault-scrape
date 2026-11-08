/**
 * 媒体服务：把「按媒体 ID 读文件」的能力暴露成本机 HTTP。
 *
 * 为什么需要它：搭手插件窗口是沙箱页面，没有自定义协议；而 `<img>` / `<video>`
 * 需要一个能直接喂给标签的本机地址。宿主 CSP 已放行 `http://127.0.0.1:*` 的
 * img-src / media-src，所以这里起一个只绑回环地址的 HTTP 服务最直接。
 *
 * 契约：
 * - 只绑 `127.0.0.1`，且路径必须带一次性 token（`/p/<token>/...`），
 *   等于把「按媒体 ID 读文件」的权限临时给本机页面，token 只在进程内存里；
 * - 请求路径去掉前缀后拼回媒体基地址交给 `handleMediaRequest`，
 *   Range 读取、播放期路径自愈、远端缓存全部复用同一套逻辑，**不在这里重写**；
 * - `HEAD` 只回响应头不读流；客户端断开时取消底层读取；
 * - 启动后调用 `setMediaBaseUrl()`，之后 `buildMediaUrl()` 生成的就是本服务地址；
 * - 懒启动的应用级单例，退出前调 `disposeMediaServer()`。
 */
import { randomBytes } from 'crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { setMediaBaseUrl } from '@common/types/media'
import { appendLog } from '$/db/repo/logRepo'
import { handleMediaRequest } from './mediaProtocol'

export interface MediaServer {
  /** 形如 `http://127.0.0.1:52341/p/<token>/`（末尾带斜杠） */
  baseUrl: string
  dispose(): Promise<void>
}

let running: MediaServer | null = null
let pending: Promise<MediaServer> | null = null

/** 懒启动的应用级单例；并发调用共享同一次启动 */
export async function startMediaServer(): Promise<MediaServer> {
  if (running) return running
  pending ??= launchServer()
  try {
    running = await pending
    return running
  } finally {
    pending = null
  }
}

export async function disposeMediaServer(): Promise<void> {
  const server = running
  running = null
  if (server) await server.dispose()
}

async function launchServer(): Promise<MediaServer> {
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
    throw new Error('媒体服务没有拿到可用端口')
  }
  const baseUrl = `http://127.0.0.1:${port}${prefix}`
  setMediaBaseUrl(baseUrl)
  appendLog({ level: 'info', scope: 'media', message: `媒体服务已启动：127.0.0.1:${port}` })
  return { baseUrl, dispose: () => closeServer(server) }
}

async function closeServer(server: Server): Promise<void> {
  // 先掐掉正在进行的播放请求，避免 close 一直等长连接
  server.closeAllConnections()
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
  // 把本服务的路径还原成同一套媒体基地址；token 已在 path 前缀里
  const host = request.headers.host ?? '127.0.0.1'
  const target = `http://${host}${url.pathname}${url.search}`

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
    appendLog({ level: 'warn', scope: 'media', message: `媒体服务转发失败：${message}` })
  }
}

function headerRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {}
  headers.forEach((value, key) => {
    record[key] = value
  })
  return record
}

/** 把 Web 流写进 Node 响应；客户端断开时取消读取，避免漏文件句柄 */
async function pipeBody(body: ReadableStream<Uint8Array>, response: ServerResponse): Promise<void> {
  const reader = body.getReader()
  let closed = false
  response.on('close', () => {
    closed = true
    void reader.cancel().catch(() => undefined)
  })
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done || closed) break
      if (value) {
        if (!response.write(Buffer.from(value))) {
          // 等缓冲区排空；连接中途断开也要放行，否则这里会一直挂着
          await new Promise<void>((resolve) => {
            const done = (): void => {
              response.off('drain', done)
              response.off('close', done)
              resolve()
            }
            response.once('drain', done)
            response.once('close', done)
          })
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
