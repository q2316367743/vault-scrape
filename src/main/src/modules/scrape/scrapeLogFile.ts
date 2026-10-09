/**
 * 刮削日志落文件（对应「文件行为 → 保存日志到文件」开关）。
 *
 * 契约：
 * - 开关关闭时全部是空操作，不建目录、不写文件；
 * - 开关开启时每次运行一个任务写一个文件：`~/.vault-scrape/log/scrape/<任务名>-<时间戳>.log`；
 * - 写文件失败只落到 console，**绝不**再写数据库日志（否则会递归触发写文件）；
 * - 数据库日志始终照写（appendLog），两者互不替代。
 */
import { appendFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import { appendLog } from '$/db/repo/logRepo'
import { loadSetting } from '$/modules/setting/settingStore'

export interface ScrapeRunLog {
  /** 本次运行的日志文件绝对路径；开关关闭时为空串 */
  readonly filePath: string
  /** 追加一行；开关关闭或写失败都不会抛错 */
  write(level: string, message: string): void
  /** 同时写数据库日志与文件 */
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

function logDir(): string {
  return join(app.getPath('home'), '.vault-scrape', 'log', 'scrape')
}

/** 任务名 → 安全的文件名片段（去掉路径分隔符与控制字符） */
function safeFileName(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').trim()
  return cleaned.length > 0 ? cleaned : 'task'
}

function stamp(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join('')
}

/**
 * 创建本次运行的日志出口。
 *
 * 目录在第一次写入时才创建（惰性），避免没开开关却在磁盘上留下空目录。
 */
export function createScrapeRunLog(taskName: string): ScrapeRunLog {
  const enabled = loadSetting().file.saveLogToFile
  const target = enabled
    ? join(logDir(), `${safeFileName(taskName)}-${stamp()}.log`)
    : ''
  let dirReady = false

  const write = (level: string, message: string): void => {
    if (!enabled) return
    const line = `[${new Date().toISOString()}] [${level}] ${message}\n`
    void (async (): Promise<void> => {
      try {
        if (!dirReady) {
          await mkdir(logDir(), { recursive: true })
          dirReady = true
        }
        await appendFile(target, line, 'utf-8')
      } catch (error) {
        console.error('[scrape] 日志写入文件失败', error)
      }
    })()
  }

  const sink = (level: 'info' | 'warn' | 'error') => (message: string): void => {
    appendLog({ level, scope: 'scrape', message })
    write(level, message)
  }

  return { filePath: target, write, info: sink('info'), warn: sink('warn'), error: sink('error') }
}
