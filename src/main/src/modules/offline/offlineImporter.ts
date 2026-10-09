/**
 * 离线数据包导入器：下载 → 解析 pg_dump → 建独立库 → 校验 → 原子替换。
 *
 * 契约：
 * 1. 全程只写 `~/.vault-scrape/db/r18.db*` 与 `r18-dump.sql.gz`，**绝不触碰系统库**；
 * 2. 导入到 `r18.db.import`，只有校验通过才在同目录改名成 `r18.db`（失败保留旧包）；
 * 3. 同一时刻只允许一个任务（`offlineBusy`），可随时取消（取消即丢弃临时文件）；
 * 4. 本地导入时用户选中的源文件只读、绝不删除；
 * 5. 进度 / 完成走主进程单向推送，不阻塞 IPC 调用。
 */
import { randomUUID } from 'node:crypto'
import { createWriteStream, existsSync, rmSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import Database from 'better-sqlite3'
import type { WebContents } from 'electron'
import { httpClient } from '$/modules/http/httpClient'
import { PluginError } from '@common/types/plugin'
import {
  OFFLINE_MIN_VIDEO_ROWS,
  formatBytes,
  type OfflineDone,
  type OfflinePhase,
  type OfflineProgress
} from '@common/types/offline'
import { appendOfflineLog, fetchLatestPack, readHeaderValue, recordCheckResult } from './offlineCheck'
import { sendOfflineDone, sendOfflineProgress } from './offlineEvents'
import {
  cleanupOfflineTemp,
  ensureOfflineDir,
  offlineDbSize,
  offlineDumpPath,
  offlineFreeBytes,
  offlineImportPath,
  saveOfflineState,
  swapOfflineDb
} from './offlineFileStore'
import { asRow } from './offlineMapper'
import { closeOfflineDb } from './offlineRepo'
import { PgCopyAbortError, parsePgDumpFile, type PgCopyHandlers } from './pgCopyImporter'
import {
  OFFLINE_DB_SCHEMA_VERSION,
  OFFLINE_META_TABLE,
  OFFLINE_TABLE_NAMES,
  OFFLINE_TABLE_NAME_SET,
  buildCreateTableSql,
  buildIndexSql,
  buildInsertSql
} from './offlineSchema'

/** 导入前要求的可用空间：新库约 1.8 GB + 下载包约 261 MB，其余量取 2.6 GB */
export const OFFLINE_REQUIRED_FREE_BYTES = 2600 * 1024 * 1024

/** 本地文件小于该大小时判定为选错文件 */
const MIN_DUMP_FILE_BYTES = 50 * 1024 * 1024

/** 每批提交的行数 */
const TX_BATCH_ROWS = 20000

/** 进度推送节流（毫秒） */
const PROGRESS_THROTTLE_MS = 200

/** 下载空闲超时：源站较慢，但卡死超过 60 秒即失败 */
const DOWNLOAD_IDLE_TIMEOUT_MS = 60000

const OFFLINE_USER_AGENT = 'vault-scrape-offline/1.0'

interface OfflineJob {
  id: string
  controller: AbortController
  phase: OfflinePhase
}

type JobSource = { kind: 'online' } | { kind: 'local'; dumpPath: string }

interface Reporter {
  phase: (phase: OfflinePhase, percent: number, message: string, extra?: { rows?: number; table?: string }) => void
  finish: (ok: boolean, message: string) => void
}

let currentJob: OfflineJob | null = null

export function isOfflineJobRunning(): boolean {
  return currentJob !== null
}

/** 取消当前任务；没有任务时返回 false */
export function cancelOfflineJob(): boolean {
  if (!currentJob) return false
  currentJob.controller.abort()
  return true
}

function describeThrown(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function beginJob(): OfflineJob {
  if (currentJob) throw new PluginError('offlineBusy')
  const job: OfflineJob = { id: randomUUID(), controller: new AbortController(), phase: 'idle' }
  currentJob = job
  return job
}

function createReporter(sender: WebContents, job: OfflineJob): Reporter {
  let lastAt = 0
  const push = (progress: OfflineProgress, force: boolean): void => {
    const now = Date.now()
    if (!force && now - lastAt < PROGRESS_THROTTLE_MS) return
    lastAt = now
    sendOfflineProgress(sender, progress)
  }
  return {
    phase(phase, percent, message, extra) {
      job.phase = phase
      push(
        {
          jobId: job.id,
          phase,
          percent,
          message,
          rows: extra?.rows ?? 0,
          table: extra?.table ?? ''
        },
        phase !== 'downloading' && phase !== 'importing'
      )
    },
    finish(ok, message) {
      const done: OfflineDone = { jobId: job.id, ok, message }
      sendOfflineDone(sender, done)
    }
  }
}

function assertFreeSpace(): void {
  const free = offlineFreeBytes()
  if (free > 0 && free < OFFLINE_REQUIRED_FREE_BYTES) {
    throw new PluginError(
      'io',
      `磁盘可用空间不足：需要约 ${formatBytes(OFFLINE_REQUIRED_FREE_BYTES)}，当前仅 ${formatBytes(free)}`
    )
  }
}

function assertLocalFile(dumpPath: string): void {
  if (!existsSync(dumpPath)) throw new PluginError('invalidArgument', `文件不存在：${dumpPath}`)
  if (statSync(dumpPath).size < MIN_DUMP_FILE_BYTES) {
    throw new PluginError('invalidArgument', '所选文件太小，不像 r18.dev 数据包（应为 .sql 或 .sql.gz）')
  }
}

/** 数据包日期来自文件名：r18dotdev_dump_2026-10-06.sql(.gz) */
export function packDateFromFileName(fileName: string): string {
  const matched = /r18dotdev_dump_(\d{4}-\d{2}-\d{2})\.sql(?:\.gz)?/.exec(fileName)
  return matched ? matched[1] : ''
}

async function downloadDump(
  job: OfflineJob,
  url: string,
  fileName: string,
  reporter: Reporter
): Promise<string> {
  const target = offlineDumpPath()
  rmSync(target, { force: true })
  const response = await httpClient.get<Readable>(url, {
    responseType: 'stream',
    maxRedirects: 5,
    validateStatus: () => true,
    signal: job.controller.signal,
    timeout: DOWNLOAD_IDLE_TIMEOUT_MS,
    headers: {
      'User-Agent': OFFLINE_USER_AGENT,
      Accept: 'application/gzip,application/octet-stream,*/*'
    }
  })
  if (response.status >= 400) {
    throw new PluginError('offlineCheckFailed', `下载数据包失败：HTTP ${response.status}`)
  }
  const total = Number.parseInt(readHeaderValue(response.headers, 'content-length'), 10) || 0
  let loaded = 0
  let lastPercent = -1
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      loaded += chunk.length
      const percent = total > 0 ? Math.min(99, Math.floor((loaded / total) * 100)) : -1
      if (percent !== lastPercent) {
        lastPercent = percent
        reporter.phase(
          'downloading',
          percent,
          `正在下载 ${fileName}（${formatBytes(loaded)}${total > 0 ? ` / ${formatBytes(total)}` : ''}）`
        )
      }
      callback(null, chunk)
    }
  })
  await pipeline(response.data, meter, createWriteStream(target))
  reporter.phase('downloading', 100, `下载完成：${formatBytes(loaded)}`)
  return target
}

function createMetaTable(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS ${OFFLINE_META_TABLE} (key TEXT PRIMARY KEY, value TEXT)`)
}

function writeMeta(db: Database.Database, values: Record<string, string>): void {
  const statement = db.prepare(
    `INSERT OR REPLACE INTO ${OFFLINE_META_TABLE} (key, value) VALUES (?, ?)`
  )
  for (const [key, value] of Object.entries(values)) statement.run(key, value)
}

function integrityMessages(result: unknown): string[] {
  if (!Array.isArray(result)) return []
  const messages: string[] = []
  for (const raw of result) {
    for (const value of Object.values(asRow(raw))) {
      if (typeof value === 'string') messages.push(value)
    }
  }
  return messages
}

function verifyImported(db: Database.Database, tableCounts: Record<string, number>): void {
  const videoRows = tableCounts.derived_video ?? 0
  if (videoRows < OFFLINE_MIN_VIDEO_ROWS) {
    throw new PluginError(
      'offlineCorrupt',
      `数据包不完整：derived_video 仅 ${videoRows} 行（至少需要 ${OFFLINE_MIN_VIDEO_ROWS} 行）`
    )
  }
  const messages = integrityMessages(db.pragma('integrity_check'))
  const broken = messages.find((message) => message.toLowerCase() !== 'ok')
  if (broken !== undefined) {
    throw new PluginError('offlineCorrupt', `数据包校验失败：${broken}`)
  }
}

function discardImport(db: Database.Database | null): void {
  if (db) {
    try {
      if (db.inTransaction) db.exec('ROLLBACK')
      db.close()
    } catch {
      // 关闭失败不影响后续删文件
    }
  }
  cleanupOfflineTemp(false)
}

interface ImportOutcome {
  rows: number
  packDate: string
}

/** 解析数据包写入临时库、校验、原子替换 */
async function importPack(
  job: OfflineJob,
  reporter: Reporter,
  dumpPath: string,
  sourceUrl: string,
  fileName: string
): Promise<ImportOutcome> {
  const importPath = offlineImportPath()
  const db = new Database(importPath)
  const tableCounts: Record<string, number> = {}
  let totalRows = 0
  let ignoredRows = 0
  let insert: Database.Statement | null = null
  let pendingRows = 0
  let parsedBytes = 0
  let parsedTotal = 0

  const commit = (): void => {
    if (db.inTransaction) db.exec('COMMIT')
  }

  const handlers: PgCopyHandlers = {
    onTableStart(info) {
      db.exec(buildCreateTableSql(info.table, info.columns))
      for (const statement of buildIndexSql(info.table, info.columns)) db.exec(statement)
      insert = db.prepare(buildInsertSql(info.table, info.columns))
      tableCounts[info.table] = 0
      pendingRows = 0
      db.exec('BEGIN')
    },
    onRows(tableName, rows) {
      if (insert === null) return
      for (const values of rows) {
        const result = insert.run(values)
        if (result.changes === 0) ignoredRows += 1
      }
      totalRows += rows.length
      tableCounts[tableName] = (tableCounts[tableName] ?? 0) + rows.length
      pendingRows += rows.length
      if (pendingRows >= TX_BATCH_ROWS) {
        commit()
        pendingRows = 0
        db.exec('BEGIN')
      }
      const percent = parsedTotal > 0 ? Math.min(99, Math.floor((parsedBytes / parsedTotal) * 100)) : -1
      reporter.phase('importing', percent, `正在导入 ${tableName}（已 ${totalRows} 行）`, {
        rows: totalRows,
        table: tableName
      })
    },
    onTableEnd() {
      commit()
      pendingRows = 0
    },
    onProgress(state) {
      parsedBytes = state.bytes
      parsedTotal = state.total
    },
    shouldAbort: () => job.controller.signal.aborted
  }

  try {
    db.pragma('journal_mode = OFF')
    db.pragma('synchronous = OFF')
    db.pragma('locking_mode = EXCLUSIVE')
    db.pragma('temp_store = MEMORY')
    db.pragma('cache_size = -131072')
    db.pragma('foreign_keys = OFF')
    createMetaTable(db)
    reporter.phase('importing', -1, '正在解析数据包…')
    const stats = await parsePgDumpFile(dumpPath, handlers, OFFLINE_TABLE_NAME_SET)
    commit()
    const packDate = packDateFromFileName(fileName)
    writeMeta(db, {
      schema_version: String(OFFLINE_DB_SCHEMA_VERSION),
      pack_date: packDate,
      source_url: sourceUrl,
      imported_at: String(Date.now()),
      video_count: String(tableCounts.derived_video ?? 0),
      row_count: String(stats.rows),
      table_counts: JSON.stringify(tableCounts)
    })
    for (const name of OFFLINE_TABLE_NAMES) tableCounts[name] = tableCounts[name] ?? 0
    reporter.phase('verifying', -1, '正在校验数据完整性（大库可能需要一分钟）…')
    verifyImported(db, tableCounts)
    db.pragma('optimize')
    db.close()
  } catch (error) {
    discardImport(db)
    throw error
  }

  if (ignoredRows > 0) {
    appendOfflineLog('warn', `离线数据包导入时忽略了 ${ignoredRows} 行重复数据`)
  }
  reporter.phase('swapping', -1, '正在切换离线数据包…')
  closeOfflineDb()
  swapOfflineDb()
  const dbBytes = offlineDbSize()
  const importedAt = Date.now()
  saveOfflineState({ packDate: packDateFromFileName(fileName), importedAt, dbBytes, corrupt: false })
  return { rows: totalRows, packDate: packDateFromFileName(fileName) }
}

async function runJob(job: OfflineJob, sender: WebContents, source: JobSource): Promise<void> {
  const reporter = createReporter(sender, job)
  const startedAt = Date.now()
  let dumpPath = ''
  let downloaded = false
  try {
    ensureOfflineDir()
    cleanupOfflineTemp(false)

    let fileName: string
    let sourceUrl: string
    let rows = 0
    let packDate = ''
    if (source.kind === 'online') {
      reporter.phase('checking', -1, '正在检查上游数据包…')
      const latest = await fetchLatestPack()
      recordCheckResult(latest)
      fileName = latest.fileName
      sourceUrl = latest.url
      reporter.phase('precheck', -1, '正在检查磁盘空间…')
      assertFreeSpace()
      reporter.phase('downloading', 0, `正在下载 ${fileName}`)
      dumpPath = await downloadDump(job, latest.url, fileName, reporter)
      downloaded = true
    } else {
      assertLocalFile(source.dumpPath)
      assertFreeSpace()
      fileName = basename(source.dumpPath)
      sourceUrl = 'local'
      dumpPath = source.dumpPath
      reporter.phase('precheck', -1, '正在检查数据包…')
    }

    const outcome = await importPack(job, reporter, dumpPath, sourceUrl, fileName)
    rows = outcome.rows
    packDate = outcome.packDate
    // 在线下载的临时包导入成功后删除；本地导入的源文件绝不删除
    if (downloaded) cleanupOfflineTemp(true)
    else cleanupOfflineTemp(false)
    const spent = Math.max(1, Math.round((Date.now() - startedAt) / 1000))
    const summary = `已导入 ${rows} 行，数据包日期 ${packDate.length > 0 ? packDate : '未知'}，用时 ${spent} 秒`
    reporter.finish(true, summary)
    appendOfflineLog('info', `离线数据包导入完成：${summary}`)
  } catch (error) {
    discardImport(null)
    if (downloaded) rmSync(offlineDumpPath(), { force: true })
    const cancelled = error instanceof PgCopyAbortError
    const message = cancelled ? '已取消导入' : describeThrown(error)
    reporter.finish(false, message)
    appendOfflineLog(cancelled ? 'warn' : 'error', `离线数据包导入失败：${message}`)
  } finally {
    currentJob = null
  }
}

/** 启动「下载并导入最新数据包」任务，立即返回 jobId */
export function startOfflineUpdateJob(sender: WebContents): { jobId: string } {
  const job = beginJob()
  void runJob(job, sender, { kind: 'online' })
  return { jobId: job.id }
}

/** 启动「从本地文件导入」任务，立即返回 jobId */
export function startOfflineLocalImportJob(sender: WebContents, dumpPath: string): { jobId: string } {
  const job = beginJob()
  void runJob(job, sender, { kind: 'local', dumpPath })
  return { jobId: job.id }
}
