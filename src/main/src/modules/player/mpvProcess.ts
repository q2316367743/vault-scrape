/**
 * mpv 进程与启动参数。
 *
 * 契约：
 * - 参数基线固定（`buildMpvArgs`）：不吃用户配置、不开 OSC、不抢系统快捷键，
 *   播放控件全部由 Electron 自绘后经 IPC 驱动，这样两平台行为一致；
 * - 嵌入模式（Windows）用 `--wid=<宿主窗口句柄>`：mpv 会建一个属于该窗口的子窗口，
 *   尺寸由 mpv 跟着宿主客户区自己对齐（见 mpv 源码 `resize_child_win`），这里不再插手；
 * - 独立窗口模式（macOS）用 `--no-border` + `--geometry`；
 * - 只刻意避开版本相关的开关（如 `--focus-on-open`、`--window-dragging`）：参数不认识时 mpv 会直接退出，
 *   而那正是「起不来」最难排查的一类故障；
 * - stderr 只留最后几行：mpv 起不来时把原因回给用户，比只有一句「启动失败」有用。
 */
import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'

/** stderr 保留行数（诊断用） */
const STDERR_LINES = 12

export interface MpvLaunchOptions {
  /** mpv 可执行文件绝对路径 */
  exe: string
  /** 回环播放服务给出的地址 */
  url: string
  /** 窗口标题（Windows 嵌入模式无关紧要，macOS 独立窗口与任务栏会用到） */
  title: string
  /** IPC 地址：Windows 命名管道 / macOS unix socket 文件 */
  ipcPath: string
  /** 初始音量 0-1 */
  volume: number
  /** Windows：宿主窗口句柄（十进制字符串）；给了就嵌入 */
  wid?: string
  /** macOS：独立窗口的 `WxH+X+Y`（屏幕坐标） */
  geometry?: string
  /** 起播位置（秒）：macOS 换 geometry 要重启进程，用这个把进度接回去 */
  startPosition?: number
  /** 起播即暂停：同上，重启后不让画面自己播起来 */
  paused?: boolean
  /** 静音：同上 */
  muted?: boolean
  /** 倍速：同上 */
  speed?: number
}

export interface MpvExitInfo {
  code: number | null
  stderr: string
}

export interface MpvProcess {
  readonly pid: number
  /** 已经退出时有值，仍在跑时为 null */
  readonly exitInfo: MpvExitInfo | null
  /** 进程退出时兑现（`error` 事件也算退出，此时 `code` 为 null、`stderr` 是错误信息） */
  readonly exited: Promise<MpvExitInfo>
  kill(): void
}

/** 拼 mpv 命令行：基线开关 + 平台呈现 + 播放地址 */
export function buildMpvArgs(options: MpvLaunchOptions): string[] {
  const args = [
    '--no-config',
    '--no-scripts',
    '--idle=yes',
    '--keep-open=yes',
    '--force-window=yes',
    '--osc=no',
    '--input-terminal=no',
    `--input-ipc-server=${options.ipcPath}`,
    '--hwdec=auto-safe',
    `--volume=${String(Math.round(options.volume * 100))}`,
    `--title=${options.title}`
  ]
  // 位置 / 暂停 / 静音 / 倍速只在「重启接续」时出现，正常起播交给 IPC 设置
  if (options.startPosition !== undefined && options.startPosition > 0) {
    args.push(`--start=${String(Math.round(options.startPosition * 10) / 10)}`)
  }
  if (options.paused === true) args.push('--pause=yes')
  if (options.muted === true) args.push('--mute=yes')
  if (options.speed !== undefined && options.speed > 0) args.push(`--speed=${String(options.speed)}`)
  if (options.wid) {
    args.push(`--wid=${options.wid}`)
  } else {
    args.push('--no-border')
    if (options.geometry) args.push(`--geometry=${options.geometry}`)
  }
  args.push(options.url)
  return args
}

export function launchMpvProcess(options: MpvLaunchOptions): MpvProcess {
  const child = spawnMpv(options)
  const lines: string[] = []
  let exitInfo: MpvExitInfo | null = null

  child.stderr?.setEncoding('utf-8')
  child.stderr?.on('data', (chunk: string) => {
    for (const line of chunk.split('\n')) {
      const text = line.trim()
      if (text.length === 0) continue
      lines.push(text)
      if (lines.length > STDERR_LINES) lines.shift()
    }
  })

  const exited = new Promise<MpvExitInfo>((resolve) => {
    child.once('error', (error) => {
      const info: MpvExitInfo = { code: null, stderr: error.message }
      exitInfo ??= info
      resolve(info)
    })
    child.once('exit', (code) => {
      const info: MpvExitInfo = { code, stderr: lines.join(' | ') }
      exitInfo ??= info
      resolve(info)
    })
  })

  return {
    pid: child.pid ?? 0,
    get exitInfo() {
      return exitInfo
    },
    exited,
    kill: () => {
      child.kill()
    }
  }
}

function spawnMpv(options: MpvLaunchOptions): ChildProcess {
  return spawn(options.exe, buildMpvArgs(options), {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  })
}
