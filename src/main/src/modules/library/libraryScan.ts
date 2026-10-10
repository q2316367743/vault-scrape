/**
 * 资料库扫描：逐个媒体目录递归索引，扫完清理失效条目，再按设置自动刮削。
 *
 * 契约：
 * - **全局单例**：同一时刻只允许一个资料库扫描，第二个请求直接返回 `busy`；
 * - 每个媒体目录独立 BFS（见 `mediaIndexer`），全部扫完才做一次清理；
 * - 哪些后缀算视频由设置里该库类型的清单决定（`libraryExtensionsOf`）；
 * - 体积小于资料库 `minFileSizeMb` 的视频不入库（门槛传给 `mediaIndexer`）；
 * - 用户取消时**不清理、不更新 `lastScanAt`**，抛 `cancelled`（渲染层显示「扫描已取消」）；
 * - 自动刮削失败（没配插件、已有任务在跑）不影响扫描结果，只在返回值里回报原因。
 */
import { randomUUID } from 'node:crypto'
import {
  LIBRARY_ERROR_MESSAGES,
  LibraryError,
  describeLibraryError,
  type LibraryScanResult,
  type MediaLibrary
} from '@common/types/library'
import { libraryExtensionsOf } from '@common/types/setting'
import type { ScrapeTaskSnapshot } from '@common/types/scrape'
import { getConnection } from '$/modules/file/fileConnectionStore'
import { cleanupUnseen, indexLibraryPath } from '$/modules/media/mediaIndexer'
import { getScrapeTask, isScrapeRunning } from '$/modules/scrape/scrapeRunner'
import { loadSetting } from '$/modules/setting/settingStore'
import { broadcastLibraryProgress } from './libraryEvents'
import { pendingEntries, startLibraryScrape } from './libraryScrape'
import { patchLibrary } from '$/db/repo/libraryRepo'
import { requireLibrary } from './libraryStore'

/** 正在扫描的资料库 ID；空串表示空闲 */
let scanningId = ''
let cancelled = false

/** 当前是否有资料库扫描在跑（渲染层据此禁用按钮） */
export function isLibraryScanRunning(): boolean {
  return scanningId.length > 0
}

/** 请求取消当前扫描；返回是否真的有扫描可取消 */
export function cancelLibraryScan(): boolean {
  if (scanningId.length === 0) return false
  cancelled = true
  return true
}

/** 扫描结束后按设置决定要不要自动刮削，返回任务与「没刮」的原因 */
async function autoScrape(
  library: MediaLibrary,
  pending: number
): Promise<{ task: ScrapeTaskSnapshot | null; skipped: string }> {
  if (!loadSetting().scrape.autoScrapeAfterScan) {
    return { task: null, skipped: '设置中已关闭「扫描后自动刮削」' }
  }
  if (library.scrapers.length === 0) return { task: null, skipped: '该资料库未配置刮削器，已跳过刮削' }
  if (pending === 0) return { task: null, skipped: '没有待刮削的影片' }
  if (isScrapeRunning()) return { task: null, skipped: '已有刮削任务在运行，可稍后手动刮削' }
  try {
    const started = await startLibraryScrape(library.id)
    return { task: getScrapeTask(started.taskId), skipped: '' }
  } catch (error) {
    return { task: null, skipped: describeLibraryError(error).message }
  }
}

/**
 * 扫描一个资料库：逐目录索引 + 清理 + 统计待刮削 + 按设置自动刮削。
 *
 * 长任务：进度用 `library:progress` 推送，函数在扫描结束后才 resolve。
 */
export async function scanLibrary(libraryId: string): Promise<LibraryScanResult> {
  const id = libraryId.trim()
  if (id.length === 0) throw new LibraryError('invalidArgument', '缺少资料库 ID')
  if (scanningId.length > 0) throw new LibraryError('busy', '已有扫描任务在运行，请稍候')
  const library = requireLibrary(id)
  if (library.paths.length === 0) throw new LibraryError('invalidArgument', '请至少添加一个媒体目录')
  for (const item of library.paths) {
    if (!getConnection(item.connectionId)) throw new LibraryError('connectionMissing')
  }

  scanningId = id
  cancelled = false
  const scanId = randomUUID()
  const extensions = libraryExtensionsOf(loadSetting().library, library.type)
  const keepImages = new Set<string>()
  let scannedDirs = 0
  let indexedFiles = 0
  let indexedVideos = 0
  let skippedDirs = 0
  const skippedPaths: string[] = []
  let truncated = false

  try {
    for (const libPath of library.paths) {
      const baseDirs = scannedDirs
      const baseFiles = indexedFiles
      broadcastLibraryProgress({
        libraryId: id,
        phase: 'scan',
        scannedDirs,
        indexedFiles,
        currentPath: libPath.path,
        finished: false,
        cancelled: false
      })
      const result = await indexLibraryPath(library, libPath, {
        scanId,
        extensions,
        minFileSizeMb: library.minFileSizeMb,
        isCancelled: () => cancelled,
        onDir: (progress) => {
          scannedDirs = baseDirs + progress.scannedDirs
          indexedFiles = baseFiles + progress.indexedFiles
          broadcastLibraryProgress({
            libraryId: id,
            phase: 'scan',
            scannedDirs,
            indexedFiles,
            currentPath: progress.dirPath,
            finished: false,
            cancelled: false
          })
        }
      })
      scannedDirs = baseDirs + result.scannedDirs
      indexedFiles = baseFiles + result.indexedFiles
      indexedVideos += result.indexedVideos
      skippedDirs += result.skippedDirs
      skippedPaths.push(...result.skippedPaths)
      truncated = truncated || result.truncated
      for (const key of result.seenImages) keepImages.add(key)
    }

    const removedItems = cleanupUnseen(id, scanId, keepImages, skippedPaths)
    const updated = patchLibrary(id, { lastScanAt: Date.now() }) ?? library
    const pending = pendingEntries(id).length
    const auto = await autoScrape(updated, pending)
    broadcastLibraryProgress({
      libraryId: id,
      phase: 'scan',
      scannedDirs,
      indexedFiles,
      currentPath: '',
      finished: true,
      cancelled: false
    })

    const notes: string[] = []
    if (removedItems > 0) notes.push(`清理 ${removedItems} 个失效条目`)
    if (truncated) notes.push('已达扫描上限，结果可能不完整')
    if (skippedDirs > 0) notes.push(`跳过 ${skippedDirs} 个读不到的目录`)

    return {
      library: updated,
      indexedFiles,
      indexedVideos,
      removedItems,
      skippedDirs,
      pending,
      message: notes.join('；'),
      autoScrape: auto.task,
      autoScrapeSkipped: auto.skipped
    }
  } catch (error) {
    if (error instanceof LibraryError && error.code === 'cancelled') {
      broadcastLibraryProgress({
        libraryId: id,
        phase: 'scan',
        scannedDirs,
        indexedFiles,
        currentPath: '',
        finished: true,
        cancelled: true
      })
      throw new LibraryError('cancelled')
    }
    if (error instanceof LibraryError) throw error
    const message = error instanceof Error ? error.message : LIBRARY_ERROR_MESSAGES.scanFailed
    throw new LibraryError('scanFailed', `扫描失败：${message}`)
  } finally {
    scanningId = ''
    cancelled = false
  }
}
