/**
 * 展示格式化工具（体积 / 时间 / 时长）：影视墙、影视详情与工作台共用。
 *
 * 契约：纯函数，不依赖 Vue 与 tdesign；未知值一律显示成「—」，绝不抛异常。
 */

/** 体积按 1024 进制折算；未知或 0 显示成「—」 */
export function formatSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const digits = unitIndex === 0 || value >= 100 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unitIndex]}`
}

/** 时间戳 → `YYYY-MM-DD HH:mm`；未知或 0 显示成「—」 */
export function formatTime(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return '—'
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 时长（分钟）→ 中文文本；0 或负数表示未知 */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—'
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  if (hours === 0) return `${rest} 分钟`
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分钟`
}
