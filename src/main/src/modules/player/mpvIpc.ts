/**
 * mpv 的 JSON IPC 客户端（`--input-ipc-server`）。
 *
 * 契约：
 * - 行分隔 JSON：请求 `{ command: [...], request_id }`，带同一 `request_id` 的应答里
 *   `error === 'success'` 才算成功；`data` 原样返回；
 * - `command()` 在连接已断或 5 秒内没有应答时抛错，由调用方决定怎么回退；
 * - `on(name, …)` 只转发 `event` 等于 `name` 的消息，不做任何解释；
 * - 一个连接只属于一个 mpv 进程，`dispose()` 之后不可复用。
 */
import { connect, type Socket } from 'net'
import { delay } from '$/utils/timing'

const REQUEST_TIMEOUT_MS = 5_000
/** 连接重试间隔：mpv 起来到 IPC 可用之间有个几百毫秒的窗口 */
const RETRY_INTERVAL_MS = 150

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface ListenerEntry {
  name: string
  listener: (message: Record<string, unknown>) => void
}

export class MpvIpc {
  private readonly socket: Socket
  private readonly pending = new Map<number, PendingRequest>()
  private readonly listeners = new Set<ListenerEntry>()
  private buffer = ''
  private nextRequestId = 1
  private closed = false

  private constructor(socket: Socket) {
    this.socket = socket
    socket.setEncoding('utf-8')
    socket.on('data', (chunk: string) => this.handleData(chunk))
    socket.on('error', (error: Error) => this.failAll(error))
    socket.on('close', () => this.failAll(new Error('mpv 连接已关闭')))
  }

  /** 反复重试直到 `timeoutMs`：mpv 起进程与 IPC 就绪之间有间隔 */
  static async connect(address: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<MpvIpc> {
    const deadline = Date.now() + timeoutMs
    let lastError = new Error('mpv IPC 连接失败')
    for (;;) {
      try {
        return new MpvIpc(await openSocket(address))
      } catch (error) {
        lastError = error instanceof Error ? error : lastError
        if (Date.now() >= deadline) throw lastError
        await delay(RETRY_INTERVAL_MS)
      }
    }
  }

  command(command: unknown[]): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('mpv 连接已关闭'))
    const requestId = this.nextRequestId++
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`mpv 没有在 ${REQUEST_TIMEOUT_MS / 1000} 秒内应答`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(requestId, { resolve, reject, timer })
      this.socket.write(`${JSON.stringify({ command, request_id: requestId })}\n`)
    })
  }

  /** 订阅事件，返回取消订阅函数 */
  on(name: string, listener: (message: Record<string, unknown>) => void): () => void {
    const entry: ListenerEntry = { name, listener }
    this.listeners.add(entry)
    return () => {
      this.listeners.delete(entry)
    }
  }

  dispose(): void {
    this.failAll(new Error('mpv 连接已释放'))
    this.socket.destroy()
  }

  private handleData(chunk: string): void {
    this.buffer += chunk
    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 1)
      if (line.trim().length > 0) this.dispatch(line)
      index = this.buffer.indexOf('\n')
    }
  }

  private dispatch(line: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return
    }
    if (!isRecord(parsed)) return

    const requestId = parsed.request_id
    if (typeof requestId === 'number') {
      const pending = this.pending.get(requestId)
      if (!pending) return
      this.pending.delete(requestId)
      clearTimeout(pending.timer)
      if (parsed.error === 'success') pending.resolve(parsed.data)
      else pending.reject(new Error(typeof parsed.error === 'string' ? parsed.error : 'mpv 命令失败'))
      return
    }

    const event = parsed.event
    if (typeof event !== 'string') return
    for (const entry of [...this.listeners]) {
      if (entry.name === event) entry.listener(parsed)
    }
  }

  private failAll(error: Error): void {
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function openSocket(address: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(address)
    const onError = (error: Error): void => {
      socket.destroy()
      reject(error)
    }
    socket.once('error', onError)
    socket.once('connect', () => {
      socket.off('error', onError)
      resolve(socket)
    })
  })
}
