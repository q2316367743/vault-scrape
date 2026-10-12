/**
 * 找 mpv 可执行文件（Windows / macOS）。
 *
 * 契约：
 * - 顺序：设置项 `app.mpvPath` → PATH（`where` / `which`）→ 常见安装位置；
 * - 只判「能不能执行」，找不到就返回 `found: false`，不抛错——由调用方静默回退内置播放器；
 * - 自动探测结果缓存 30 秒（每次开播放窗口都会问一次）；设置页点「检测」走 `detectMpv`，强制重探。
 */
import { execFile } from 'child_process'
import { accessSync, constants } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import type { PlayerMpvOrigin, PlayerProbeResult } from '@common/types/player'
import { loadSetting } from '$/modules/setting/settingStore'

const run = promisify(execFile)

const CACHE_MS = 30_000

/** 探测结果（带来源，设置页据此说明「用的是你填的还是自动找到的」） */
export interface MpvLocation {
  found: boolean
  path: string
  origin: PlayerMpvOrigin
}

const WELL_KNOWN: readonly string[] = [
  '/opt/homebrew/bin/mpv',
  '/usr/local/bin/mpv',
  '/usr/bin/mpv',
  '/Applications/mpv.app/Contents/MacOS/mpv',
  'C:\\Program Files\\mpv\\mpv.exe',
  'C:\\Program Files (x86)\\mpv\\mpv.exe',
  join(process.env.LOCALAPPDATA ?? 'C:\\', 'mpv', 'mpv.exe')
]

let cache: { at: number; location: MpvLocation } | null = null

/** 设置页改了路径之后要重新探测 */
export function resetMpvCache(): void {
  cache = null
}

/** 当前该用哪个 mpv；`found: false` 时调用方走内置播放器 */
export async function locateMpv(): Promise<MpvLocation> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_MS) return cache.location
  const location = await resolve(loadSetting().app.mpvPath)
  cache = { at: now, location }
  return location
}

/** 设置页「检测」：按输入框里的路径（留空则自动探测）验证，并取一行版本号 */
export async function detectMpv(input: string): Promise<PlayerProbeResult> {
  const location = await resolve(input.trim())
  if (!location.found) return { found: false, path: '', version: '', origin: location.origin }
  resetMpvCache()
  return {
    found: true,
    path: location.path,
    version: await probeVersion(location.path),
    origin: location.origin
  }
}

async function resolve(settingPath: string): Promise<MpvLocation> {
  if (usable(settingPath)) return { found: true, path: settingPath, origin: 'setting' }
  const fromEnv = await fromPathEnv()
  if (fromEnv.length > 0) return { found: true, path: fromEnv, origin: 'path' }
  const hit = WELL_KNOWN.find(usable)
  if (hit) return { found: true, path: hit, origin: 'well-known' }
  return { found: false, path: '', origin: 'none' }
}

/** `accessSync` + X_OK：Windows 上 X_OK 退化成存在性判断，正是我们要的 */
function usable(path: string): boolean {
  if (path.trim().length === 0) return false
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function fromPathEnv(): Promise<string> {
  try {
    const { stdout } = await run(process.platform === 'win32' ? 'where' : 'which', ['mpv'], {
      windowsHide: true,
      timeout: 5_000
    })
    return (
      stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(usable) ?? ''
    )
  } catch {
    return ''
  }
}

/** 跑一次 `mpv --version` 取首行；跑不动就返回空串（检测结果仍算「找到」） */
async function probeVersion(path: string): Promise<string> {
  try {
    const { stdout } = await run(path, ['--version'], { windowsHide: true, timeout: 5_000 })
    return stdout.split(/\r?\n/)[0]?.trim() ?? ''
  } catch {
    return ''
  }
}
