/**
 * 离线模块的运行时状态（`~/.vault-scrape/db/r18-state.json`）与纯工具函数。
 *
 * 契约：状态文件可能被手工改坏或来自旧版本，读取一律「取值失败即回落默认」，绝不抛错。
 */
import { readBoolean, readNumber, readString, toSource } from '../setting/shared'

export const OFFLINE_STATE_VERSION = 1

/** 自动检查更新的间隔：7 天 */
export const OFFLINE_AUTO_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

/** 导入完成的影片行数下限，低于该值视为数据包不完整 */
export const OFFLINE_MIN_VIDEO_ROWS = 1000000

/** 桌面上游数据包地址：会 302/307 重定向到最新文件 */
export const OFFLINE_DUMPS_LATEST_URL = 'https://r18.dev/dumps/latest'

/** 数据包文件名里的日期：r18dotdev_dump_2026-10-06.sql / .sql.gz */
export const OFFLINE_DUMP_FILE_PATTERN = /r18dotdev_dump_(\d{4}-\d{2}-\d{2})\.sql(?:\.gz)?/

/** 运行时状态：库文件之外的检查与更新信息，库被删/损坏后依然可读 */
export interface OfflinePackState {
  version: number
  /** 最近一次成功检查的时间戳（毫秒），0 表示从未检查 */
  lastCheckAt: number
  /** 上游最新数据包日期 */
  latestPackDate: string
  /** 本地数据包日期（库内元数据的镜像，便于不打开库就能展示） */
  packDate: string
  /** 导入完成时间戳（毫秒） */
  importedAt: number
  /** 库文件体积（字节） */
  dbBytes: number
  /** 上次打开时发现库损坏 */
  corrupt: boolean
}

export function buildOfflineState(): OfflinePackState {
  return {
    version: OFFLINE_STATE_VERSION,
    lastCheckAt: 0,
    latestPackDate: '',
    packDate: '',
    importedAt: 0,
    dbBytes: 0,
    corrupt: false
  }
}

export function normalizeOfflineState(raw: unknown): OfflinePackState {
  const source = toSource(raw)
  if (!source) return buildOfflineState()
  return {
    version: OFFLINE_STATE_VERSION,
    lastCheckAt: readNumber(source, 'lastCheckAt', 0),
    latestPackDate: normalizePackDate(readString(source, 'latestPackDate', '')),
    packDate: normalizePackDate(readString(source, 'packDate', '')),
    importedAt: readNumber(source, 'importedAt', 0),
    dbBytes: readNumber(source, 'dbBytes', 0),
    corrupt: readBoolean(source, 'corrupt', false)
  }
}

/** 只接受 YYYY-MM-DD，其余回落空串 */
export function normalizePackDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
}

/** 数据包日期可直接按字典序比较：latest 更新则为 true */
export function isNewerPackDate(latest: string, current: string): boolean {
  const next = normalizePackDate(latest)
  if (next.length === 0) return false
  const base = normalizePackDate(current)
  if (base.length === 0) return true
  return next > base
}

/** 格式化为「2026-10-06 12:30」；无效时间戳返回空串 */
export function formatTime(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return ''
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 人类可读体积 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}
