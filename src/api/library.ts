/**
 * 资料库模块桥：所有调用返回 `LibraryResult` 信封；扫描走长任务通道。
 */
import type {
  LibraryProgressEvent,
  LibraryResult,
  LibraryScanResult,
  LibraryTaskResult,
  MediaLibrary,
  MediaLibraryDraft
} from '@common/types/library'
import { CORE_EVENTS } from '@common/channels'
import { subscribe } from './events'
import { callCore } from './invoke'
import { runJob } from './job'

export const libraryApi = {
  list: (): Promise<LibraryResult<MediaLibrary[]>> => callCore('libraryList'),

  save: (draft: MediaLibraryDraft): Promise<LibraryResult<MediaLibrary>> =>
    callCore('librarySave', { draft }),

  remove: (libraryId: string): Promise<LibraryResult<boolean>> =>
    callCore('libraryRemove', { libraryId }),

  /** 递归扫描（长任务）；期间用 `onProgress` 推进度，扫描完成后才 resolve */
  scan: (libraryId: string): Promise<LibraryResult<LibraryScanResult>> =>
    runJob('library.scan', { libraryId }),

  cancelScan: (): Promise<LibraryResult<boolean>> => callCore('libraryCancelScan'),

  /** 刮削已扫描的影视；返回任务快照 ID 与队列条数 */
  scrape: (libraryId: string): Promise<LibraryResult<LibraryTaskResult>> =>
    callCore('libraryScrape', { libraryId }),

  /** core 是否有扫描在跑：扫描不受窗口开关影响，状态从 core 读 */
  running: (): Promise<LibraryResult<boolean>> => callCore('libraryRunning'),

  /** 订阅扫描进度，返回取消订阅函数 */
  onProgress: (listener: (event: LibraryProgressEvent) => void): (() => void) =>
    subscribe(CORE_EVENTS.libraryProgress, listener)
}

export type LibraryApi = typeof libraryApi
