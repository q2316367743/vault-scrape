/**
 * 离线数据包在本机的文件布局与运行时状态。
 *
 * 目录与系统库并列（`~/.vault-scrape/db/`），互不干扰：
 * - `vault-scrape.db`  系统库，本模块绝不触碰；
 * - `r18.db`           离线库（独立的 SQLite 文件）；
 * - `r18.db.import`    导入中的临时库，校验通过后原子改名成 r18.db；
 * - `r18.db.old`       替换瞬间的旧库，替换完成后立即删除；
 * - `r18-dump.sql.gz`  在线下载的数据包临时文件，导入成功后删除；
 * - `r18-state.json`   检查 / 更新状态（库被删或损坏后仍可读，用于维持 7 天检查节奏）。
 *
 * 契约：所有写操作先落临时文件再 rename，保证状态文件不会写坏；
 * 任何一步失败都不得影响系统库。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { PluginError } from '@common/types/plugin'
import {
  OFFLINE_STATE_VERSION,
  buildOfflineState,
  normalizeOfflineState,
  type OfflinePackState
} from '@common/types/offline'

/** 离线库所在目录（与系统库同目录） */
export function offlineDbDir(): string {
  return join(app.getPath('home'), '.vault-scrape', 'db')
}

/** 离线库：r18.db */
export function offlineDbPath(): string {
  return join(offlineDbDir(), 'r18.db')
}

/** 导入中的临时库：r18.db.import */
export function offlineImportPath(): string {
  return `${offlineDbPath()}.import`
}

/** 替换瞬间的旧库：r18.db.old */
export function offlineOldPath(): string {
  return `${offlineDbPath()}.old`
}

/** 在线下载的数据包临时文件：r18-dump.sql.gz */
export function offlineDumpPath(): string {
  return join(offlineDbDir(), 'r18-dump.sql.gz')
}

/** 运行时状态文件：r18-state.json */
export function offlineStatePath(): string {
  return join(offlineDbDir(), 'r18-state.json')
}

export function ensureOfflineDir(): void {
  try {
    mkdirSync(offlineDbDir(), { recursive: true })
  } catch (error) {
    throw new PluginError('io', `无法创建离线数据包目录：${describeReason(error)}`)
  }
}

function describeReason(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** 某一侧的 sqlite 附属文件（-wal / -shm / -journal） */
function sqliteSidecars(filePath: string): string[] {
  return [`${filePath}-wal`, `${filePath}-shm`, `${filePath}-journal`]
}

/** 删除一个文件及其 sqlite 附属文件 */
function removeFileWithSidecars(filePath: string): void {
  for (const target of [filePath, ...sqliteSidecars(filePath)]) {
    rmSync(target, { force: true })
  }
}

export function fileSize(filePath: string): number {
  try {
    return statSync(filePath).size
  } catch {
    return 0
  }
}

/** 离线库体积（含附属文件） */
export function offlineDbSize(): number {
  const dbPath = offlineDbPath()
  return sqliteSidecars(dbPath).reduce((total, target) => total + fileSize(target), fileSize(dbPath))
}

/** 已下载的数据包临时文件体积 */
export function offlineDumpSize(): number {
  return fileSize(offlineDumpPath())
}

/**
 * 目录可用空间（字节）；探测失败返回 0（调用方视为「不可知」，跳过空间校验）。
 */
export function offlineFreeBytes(): number {
  try {
    const stats = statfsSync(offlineDbDir())
    return Number(stats.bavail) * Number(stats.bsize)
  } catch {
    return 0
  }
}

/** 读取运行时状态；文件缺失或损坏一律回落默认值 */
export function readOfflineState(): OfflinePackState {
  const statePath = offlineStatePath()
  if (!existsSync(statePath)) return buildOfflineState()
  try {
    return normalizeOfflineState(JSON.parse(readFileSync(statePath, 'utf8')))
  } catch {
    return buildOfflineState()
  }
}

/** 合并写入运行时状态（原子写：先写 .tmp 再 rename） */
export function saveOfflineState(patch: Partial<OfflinePackState>): OfflinePackState {
  const next: OfflinePackState = { ...readOfflineState(), ...patch, version: OFFLINE_STATE_VERSION }
  try {
    ensureOfflineDir()
    const statePath = offlineStatePath()
    const tmpPath = `${statePath}.tmp`
    writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    renameSync(tmpPath, statePath)
  } catch {
    // 状态文件写失败不应中断导入：库本身已经就位
  }
  return next
}

/** 清理导入遗留的临时文件；includeDump 为 true 时连下载包一起删 */
export function cleanupOfflineTemp(includeDump: boolean): void {
  removeFileWithSidecars(offlineImportPath())
  removeFileWithSidecars(offlineOldPath())
  if (includeDump) {
    rmSync(offlineDumpPath(), { force: true })
  }
}

/**
 * 用校验通过的临时库替换现有离线库（同目录 rename，原子）。
 *
 * 调用方必须先关闭所有 r18.db 句柄（见 offlineRepo.closeOfflineDb）。
 */
export function swapOfflineDb(): void {
  const importPath = offlineImportPath()
  const dbPath = offlineDbPath()
  const oldPath = offlineOldPath()
  if (!existsSync(importPath)) {
    throw new PluginError('io', '导入结果不存在，无法替换离线数据包')
  }
  try {
    ensureOfflineDir()
    removeFileWithSidecars(oldPath)
    if (existsSync(dbPath)) renameSync(dbPath, oldPath)
    renameSync(importPath, dbPath)
    removeFileWithSidecars(oldPath)
  } catch (error) {
    throw new PluginError('io', `替换离线数据包失败：${describeReason(error)}`)
  }
}

/** 删除已安装的离线数据包与下载缓存，保留检查状态 */
export function removeOfflinePack(): boolean {
  const existed = existsSync(offlineDbPath())
  removeFileWithSidecars(offlineDbPath())
  cleanupOfflineTemp(true)
  saveOfflineState({ packDate: '', importedAt: 0, dbBytes: 0, corrupt: false })
  return existed
}
