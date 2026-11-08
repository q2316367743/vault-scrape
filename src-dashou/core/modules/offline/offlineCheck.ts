/**
 * 离线数据包的更新检查。
 *
 * 契约：
 * 1. 上游 https://r18.dev/dumps/latest 会 302/307 重定向到最新数据包
 *    （如 https://r18dotdev.s3.eu-west-1.wasabisys.com/dumps/r18dotdev_dump_2026-10-06.sql.gz）；
 *    这里**只读重定向地址**（maxRedirects: 0），不会下载文件内容；
 * 2. 检查失败不写 lastCheckAt —— 下次启动会重试，不会因为一次网络故障静默 7 天；
 * 3. 自动检查（启动时、距上次成功检查超过 7 天）只做提示，绝不自动下载；
 * 4. 代理与超时统一由 `$/modules/http/httpClient` 的拦截器按设置注入。
 */
import axios from 'axios'
import { appendLog } from '$/db/repo/logRepo'
import { httpClient } from '$/modules/http/httpClient'
import { PluginError } from '@common/types/plugin'
import {
  OFFLINE_AUTO_CHECK_INTERVAL_MS,
  OFFLINE_DUMPS_LATEST_URL,
  OFFLINE_DUMP_FILE_PATTERN,
  isNewerPackDate,
  type OfflineCheckResult
} from '@common/types/offline'
import { asRow } from './offlineMapper'
import { broadcastOfflineUpdate } from './offlineEvents'
import { readOfflineState, saveOfflineState } from './offlineFileStore'
import { localPackDate } from './offlineRepo'

/** 检查请求超时：只读一个重定向头，15 秒足够 */
const CHECK_TIMEOUT_MS = 15000

/** 上游对 UA 无特殊要求，标注自身便于排查 */
const OFFLINE_USER_AGENT = 'vault-scrape-offline/1.0'

function describeThrown(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 离线模块日志：系统库不可用时静默丢弃，不影响导入 */
export function appendOfflineLog(level: 'info' | 'warn' | 'error', message: string): void {
  try {
    appendLog({ level, scope: 'offline', message })
  } catch {
    // 日志失败不影响离线数据包流程
  }
}

/** 宽容读取响应头（axios 头对象的值类型可能是 string / string[]） */
export function readHeaderValue(headers: unknown, name: string): string {
  for (const [key, value] of Object.entries(asRow(headers))) {
    if (key.toLowerCase() !== name) continue
    if (typeof value === 'string') return value
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  }
  return ''
}

function toAbsoluteUrl(location: string): string {
  if (/^https?:\/\//i.test(location)) return location
  return new URL(location, OFFLINE_DUMPS_LATEST_URL).toString()
}

function buildResult(url: string): OfflineCheckResult {
  const fileName = decodeURIComponent(url.split('?')[0].split('/').pop() ?? '')
  const matched = OFFLINE_DUMP_FILE_PATTERN.exec(fileName)
  if (!matched) {
    throw new PluginError('offlineCheckFailed', `无法识别上游数据包文件名：${fileName || url}`)
  }
  const latestPackDate = matched[1]
  return {
    latestPackDate,
    fileName,
    url,
    updateAvailable: isNewerPackDate(latestPackDate, localPackDate())
  }
}

/**
 * 读取上游最新数据包信息（不下载文件）。
 *
 * 失败一律抛 `offlineCheckFailed`，消息面向用户可直接展示。
 */
export async function fetchLatestPack(): Promise<OfflineCheckResult> {
  try {
    const response = await httpClient.get(OFFLINE_DUMPS_LATEST_URL, {
      maxRedirects: 0,
      validateStatus: () => true,
      responseType: 'text',
      timeout: CHECK_TIMEOUT_MS,
      headers: { 'User-Agent': OFFLINE_USER_AGENT, Accept: 'text/html,application/xhtml+xml' }
    })
    const location = readHeaderValue(response.headers, 'location')
    if (location.length === 0) {
      throw new PluginError(
        'offlineCheckFailed',
        `检查离线数据包更新失败：上游返回 HTTP ${response.status}，且没有重定向地址`
      )
    }
    return buildResult(toAbsoluteUrl(location))
  } catch (error) {
    if (error instanceof PluginError) throw error
    // follow-redirects 在个别版本会把 3xx 当作错误抛出，这里再给一次机会
    if (axios.isAxiosError(error) && error.response) {
      const location = readHeaderValue(error.response.headers, 'location')
      if (location.length > 0) return buildResult(toAbsoluteUrl(location))
    }
    throw new PluginError('offlineCheckFailed', `检查离线数据包更新失败：${describeThrown(error)}`)
  }
}

/** 记录一次成功的检查（只有成功才推进 lastCheckAt） */
export function recordCheckResult(result: OfflineCheckResult): void {
  saveOfflineState({ lastCheckAt: Date.now(), latestPackDate: result.latestPackDate })
}

/** 主动检查更新：无论上次检查时间都执行 */
export async function checkOfflineUpdate(): Promise<OfflineCheckResult> {
  const result = await fetchLatestPack()
  recordCheckResult(result)
  appendOfflineLog(
    'info',
    `检查离线数据包更新：上游 ${result.latestPackDate}${result.updateAvailable ? '（有更新）' : '（已是最新）'}`
  )
  return result
}

/** 启动时的自动检查：距上次成功检查满 7 天才执行，命中更新只提示不下载 */
export async function runOfflineStartupCheck(): Promise<void> {
  try {
    const state = readOfflineState()
    if (state.lastCheckAt > 0 && Date.now() - state.lastCheckAt < OFFLINE_AUTO_CHECK_INTERVAL_MS) {
      return
    }
    const result = await fetchLatestPack()
    recordCheckResult(result)
    if (result.updateAvailable) {
      const current = localPackDate()
      broadcastOfflineUpdate({ latestPackDate: result.latestPackDate, packDate: current })
      appendOfflineLog(
        'info',
        `发现新的离线数据包：${result.latestPackDate}（本地 ${current.length > 0 ? current : '未安装'}）`
      )
    }
  } catch (error) {
    // 网络失败不推进 lastCheckAt，下次启动会重试
    appendOfflineLog('warn', `自动检查离线数据包更新失败：${describeThrown(error)}`)
  }
}
