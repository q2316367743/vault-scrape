/**
 * 一个正在跑的 mpv 实例：起进程 + 连 IPC + 订阅属性 + 把命令映射成 mpv 命令。
 *
 * 契约：
 * - 状态由 mpv 的属性推送驱动（`observe_property`），本类只做「mpv 词汇 → PlayerState」的翻译，
 *   不自己造进度：进度条、音量、倍速都以 mpv 为准；
 * - 换集走 `loadfile` 复用同一个进程（比重启快，也不会闪一下窗口）；
 * - `--geometry` 在多数 mpv 版本里不是 runtime 选项，所以 macOS 改窗口几何先试 `set_property`，
 *   失败由调用方决定是否 `restartWithGeometry()`（重启会把进度 / 音量 / 静音 / 倍速接回去）；
 * - 进程自己退掉时通知 `onExit`，由会话层降级到内置播放器；`stop()` 主动退出不会触发 `onExit`。
 */
import { randomBytes } from 'crypto'
import { unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildPlayerState, type PlayerCommand, type PlayerState } from '@common/types/player'
import { delay } from '$/utils/timing'
import { MpvIpc } from '$/modules/player/mpvIpc'
import { launchMpvProcess, type MpvExitInfo, type MpvProcess } from '$/modules/player/mpvProcess'

const CONNECT_TIMEOUT_MS = 8_000
/** 主动 `quit` 之后等这么久，还不退就 kill */
const QUIT_GRACE_MS = 1_500

/** 要订阅的 mpv 属性：ID 固定写死，`property-change` 事件按 name 分派 */
const OBSERVED_PROPERTIES: readonly (readonly [number, string])[] = [
  [1, 'time-pos'],
  [2, 'duration'],
  [3, 'pause'],
  [4, 'volume'],
  [5, 'mute'],
  [6, 'speed'],
  [7, 'cache-buffering-state'],
  [8, 'eof-reached']
]

export interface MpvStartRequest {
  /** mpv 可执行文件绝对路径 */
  exe: string
  url: string
  title: string
  /** 初始音量 0-1 */
  volume: number
  /** Windows：宿主窗口句柄（十进制字符串），给了就嵌入 */
  wid?: string
  /** macOS：独立窗口的 `WxH+X+Y`（屏幕坐标） */
  geometry?: string
}

export class MpvRuntime {
  private readonly updateListeners = new Set<() => void>()
  private readonly exitListeners = new Set<(reason: string) => void>()
  private state: PlayerState
  private stopping = false

  private constructor(
    private request: MpvStartRequest,
    private proc: MpvProcess,
    private ipc: MpvIpc,
    private address: string
  ) {
    this.state = buildPlayerState('mpv')
    this.state.volume = request.volume
    this.watch(proc)
  }

  /** 起进程 + 连 IPC + 订阅属性；任何一步失败都会把半死的进程收掉再抛错 */
  static async start(request: MpvStartRequest): Promise<MpvRuntime> {
    const address = buildIpcAddress()
    const proc = launchMpvProcess(toLaunchOptions(request, address))
    const ipc = await connectOrExplain(proc, address)
    const runtime = new MpvRuntime(request, proc, ipc, address)
    try {
      await runtime.observeAll()
    } catch (error) {
      await runtime.stop()
      throw error
    }
    return runtime
  }

  /** 状态快照（拷贝，调用方改不坏内部状态） */
  getState(): PlayerState {
    return { ...this.state }
  }

  onUpdate(listener: () => void): () => void {
    this.updateListeners.add(listener)
    return () => {
      this.updateListeners.delete(listener)
    }
  }

  onExit(listener: (reason: string) => void): () => void {
    this.exitListeners.add(listener)
    return () => {
      this.exitListeners.delete(listener)
    }
  }

  /** 换集：复用进程，状态先归零等 `file-loaded` */
  async open(url: string): Promise<void> {
    this.request = { ...this.request, url }
    this.patch({ ready: false, position: 0, duration: 0, ended: false, error: '' })
    await this.ipc.command(['loadfile', url])
  }

  async runCommand(command: PlayerCommand): Promise<void> {
    switch (command.kind) {
      case 'toggle':
        await this.ipc.command(['cycle', 'pause'])
        return
      case 'seek':
        await this.ipc.command(['seek', command.position, 'absolute'])
        return
      case 'seekBy':
        await this.ipc.command(['seek', command.delta, 'relative'])
        return
      case 'volume':
        await this.ipc.command(['set_property', 'volume', clamp(command.volume, 0, 1) * 100])
        return
      case 'mute':
        await this.ipc.command(['set_property', 'mute', command.muted])
        return
      case 'rate':
        await this.ipc.command(['set_property', 'speed', clamp(command.rate, 0.25, 4)])
        return
      case 'fullscreen':
        // 全屏是窗口层的事（Windows 宿主窗口跟随、macOS 是窗口自身），mpv 不参与
        return
      default:
        return
    }
  }

  /**
   * macOS 独立窗口模式：把 mpv 窗口挪到新几何位置。
   *
   * 返回 false 表示这个 mpv 版本改不了（`--geometry` 不是 runtime 选项），调用方走重启兜底。
   */
  async tryGeometry(geometry: string): Promise<boolean> {
    if (this.request.geometry === geometry) return true
    try {
      await this.ipc.command(['set_property', 'geometry', geometry])
      this.request = { ...this.request, geometry }
      return true
    } catch {
      return false
    }
  }

  /** 按新 geometry 重启进程并接回进度 / 音量 / 静音 / 倍速（只给 macOS 兜底用） */
  async restartWithGeometry(geometry: string): Promise<void> {
    const resume = this.state
    await this.stop()
    const address = buildIpcAddress()
    const proc = launchMpvProcess({
      ...toLaunchOptions(this.request, address),
      geometry,
      startPosition: resume.position,
      paused: resume.paused,
      muted: resume.muted,
      speed: resume.rate,
      volume: resume.volume
    })
    const ipc = await connectOrExplain(proc, address)
    this.proc = proc
    this.ipc = ipc
    this.address = address
    this.request = { ...this.request, geometry }
    this.state = { ...resume, ready: false, error: '' }
    this.stopping = false
    this.watch(proc)
    await this.observeAll()
  }

  /** 主动收摊：先好好说 quit，1.5 秒不退再 kill；不触发 onExit */
  async stop(): Promise<void> {
    this.stopping = true
    try {
      await this.ipc.command(['quit'])
    } catch {
      // 进程可能已经没了，直接进下面的兜底
    }
    const exited = await Promise.race([
      this.proc.exited,
      delay(QUIT_GRACE_MS).then(() => null as MpvExitInfo | null)
    ])
    if (exited === null) this.proc.kill()
    this.ipc.dispose()
    removeSocketFile(this.address)
  }

  private watch(proc: MpvProcess): void {
    void proc.exited.then((info) => {
      // 已经被换掉的旧进程、或主动 stop 的，不算异常退出
      if (this.proc !== proc || this.stopping) return
      this.emitExit(describeExit(info))
    })
  }

  private async observeAll(): Promise<void> {
    this.ipc.on('property-change', (message) => this.applyProperty(message))
    this.ipc.on('file-loaded', () => this.patch({ ready: true, ended: false, error: '' }))
    this.ipc.on('end-file', () => this.patch({ ready: false, ended: true }))
    for (const [id, name] of OBSERVED_PROPERTIES) {
      await this.ipc.command(['observe_property', id, name])
    }
  }

  private applyProperty(message: Record<string, unknown>): void {
    const data = message.data
    switch (message.name) {
      case 'time-pos':
        if (typeof data === 'number') this.patch({ position: data })
        return
      case 'duration':
        if (typeof data === 'number') this.patch({ duration: data })
        return
      case 'pause':
        if (typeof data === 'boolean') this.patch({ paused: data })
        return
      case 'volume':
        // mpv 的音量是 0-100，对外统一 0-1
        if (typeof data === 'number') this.patch({ volume: data / 100 })
        return
      case 'mute':
        if (typeof data === 'boolean') this.patch({ muted: data })
        return
      case 'speed':
        if (typeof data === 'number') this.patch({ rate: data })
        return
      case 'cache-buffering-state':
        if (typeof data === 'number') this.patch({ buffering: data < 100 })
        return
      case 'eof-reached':
        if (typeof data === 'boolean') this.patch({ ended: data })
        return
      default:
        return
    }
  }

  private patch(patch: Partial<PlayerState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of [...this.updateListeners]) listener()
  }

  private emitExit(reason: string): void {
    for (const listener of [...this.exitListeners]) listener(reason)
  }
}

function toLaunchOptions(request: MpvStartRequest, ipcPath: string): {
  exe: string
  url: string
  title: string
  ipcPath: string
  volume: number
  wid?: string
  geometry?: string
} {
  return {
    exe: request.exe,
    url: request.url,
    title: request.title,
    ipcPath,
    volume: request.volume,
    ...(request.wid ? { wid: request.wid } : {}),
    ...(request.geometry ? { geometry: request.geometry } : {})
  }
}

async function connectOrExplain(proc: MpvProcess, address: string): Promise<MpvIpc> {
  try {
    return await Promise.race([MpvIpc.connect(address, CONNECT_TIMEOUT_MS), exitedEarly(proc)])
  } catch (error) {
    proc.kill()
    throw error instanceof Error ? error : new Error('mpv IPC 连接失败')
  }
}

/** 起进程就挂掉时立刻给出 stderr，比干等 8 秒超时有用 */
function exitedEarly(proc: MpvProcess): Promise<never> {
  return proc.exited.then((info) => {
    throw new Error(describeExit(info))
  })
}

function describeExit(info: MpvExitInfo): string {
  const code = info.code === null ? '未知' : String(info.code)
  const detail = info.stderr.length > 0 ? `：${info.stderr}` : ''
  return `mpv 已退出（code=${code}）${detail}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Windows 用命名管道，macOS 用临时目录下的 socket 文件 */
function buildIpcAddress(): string {
  const token = randomBytes(8).toString('hex')
  if (process.platform === 'win32') return `\\\\.\\pipe\\vault-scrape-mpv-${token}`
  return join(tmpdir(), `vault-scrape-mpv-${token}.sock`)
}

function removeSocketFile(address: string): void {
  if (process.platform === 'win32') return
  try {
    unlinkSync(address)
  } catch {
    // 文件可能已经不在，忽略
  }
}
