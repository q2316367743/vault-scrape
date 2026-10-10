/**
 * 资料库模块的 IPC 注册。
 *
 * 契约（沿用 scrape / media 域的写法）：
 * 1. 模块内部抛 `LibraryError`，**只有 IPC 边界**把错误转成 `LibraryResult` 信封；
 * 2. 入参一律按 unknown 从渲染层收窄，缺字段抛 `invalidArgument`；
 * 3. 扫描在主进程运行，本文件只负责转发；进度通过 `library:progress` 单向推送。
 */
import { ipcMain } from 'electron'
import {
  LIBRARY_IMAGE_SAVE_MODES,
  LIBRARY_TYPES,
  LibraryError,
  describeLibraryError,
  libraryFail,
  libraryOk,
  type LibraryResult,
  type LibraryScanResult,
  type LibraryTaskResult,
  type MediaLibrary,
  type MediaLibraryDraft,
  type MediaLibraryPathDraft
} from '@common/types/library'
import {
  readBoolean,
  readEnum,
  readString,
  readStringArray,
  toSource
} from '@common/types/setting/shared'
import { LibraryChannels } from '~/modules/library/libraryChannels'
import { cancelLibraryScan, isLibraryScanRunning, scanLibrary } from './libraryScan'
import { startLibraryScrape } from './libraryScrape'
import { listLibraries, removeLibrary, saveLibrary } from './libraryStore'

function handle<T>(task: () => Promise<T> | T): Promise<LibraryResult<T>> {
  return Promise.resolve()
    .then(task)
    .then((data) => libraryOk(data))
    .catch((error: unknown) => {
      const { code, message } = describeLibraryError(error)
      return libraryFail(code, message)
    })
}

function payloadOf(payload: unknown): Record<string, unknown> {
  return toSource(payload) ?? {}
}

function readLibraryId(payload: unknown): string {
  const libraryId = readString(payloadOf(payload), 'libraryId', '').trim()
  if (libraryId.length === 0) throw new LibraryError('invalidArgument', '缺少资料库 ID')
  return libraryId
}

/** 渲染层提交的资料库草稿：逐字段收窄，真正的校验在 libraryStore 里做 */
function readDraft(payload: unknown): MediaLibraryDraft {
  const draft = toSource(payloadOf(payload).draft)
  if (!draft) throw new LibraryError('invalidArgument', '缺少资料库配置')
  const pathsRaw = draft.paths
  const paths: MediaLibraryPathDraft[] = Array.isArray(pathsRaw)
    ? pathsRaw.flatMap((item): MediaLibraryPathDraft[] => {
        const source = toSource(item)
        if (!source) return []
        return [
          {
            connectionId: readString(source, 'connectionId', ''),
            path: readString(source, 'path', '')
          }
        ]
      })
    : []
  const id = readString(draft, 'id', '')
  return {
    ...(id.length > 0 ? { id } : {}),
    name: readString(draft, 'name', ''),
    type: readEnum(draft, 'type', LIBRARY_TYPES, 'movie'),
    scrapers: readStringArray(draft, 'scrapers', []),
    paths,
    // 缺字段时的缺省值与 schema 保持一致：NSFW 保护与写 NFO 默认开，其余默认关
    nsfwProtection: readBoolean(draft, 'nsfwProtection', true),
    writeNfo: readBoolean(draft, 'writeNfo', true),
    renameEnabled: readBoolean(draft, 'renameEnabled', false),
    moveEnabled: readBoolean(draft, 'moveEnabled', false),
    moveDirectory: readString(draft, 'moveDirectory', ''),
    imageSaveMode: readEnum(draft, 'imageSaveMode', LIBRARY_IMAGE_SAVE_MODES, 'media')
  }
}

export function registerLibraryIpc(): void {
  ipcMain.handle(LibraryChannels.list, () => handle<MediaLibrary[]>(() => listLibraries()))

  ipcMain.handle(LibraryChannels.save, (_event, payload: unknown) =>
    handle<MediaLibrary>(() => saveLibrary(readDraft(payload)))
  )

  ipcMain.handle(LibraryChannels.remove, (_event, payload: unknown) =>
    handle<boolean>(() => removeLibrary(readLibraryId(payload)))
  )

  ipcMain.handle(LibraryChannels.scan, (_event, payload: unknown) =>
    handle<LibraryScanResult>(() => scanLibrary(readLibraryId(payload)))
  )

  ipcMain.handle(LibraryChannels.cancelScan, () => handle<boolean>(() => cancelLibraryScan()))

  ipcMain.handle(LibraryChannels.scrape, (_event, payload: unknown) =>
    handle<LibraryTaskResult>(() => startLibraryScrape(readLibraryId(payload)))
  )

  /** 渲染层挂载后用它恢复「扫描中」按钮状态：扫描在主进程跑，窗口重开也不会误判为空闲 */
  ipcMain.handle(LibraryChannels.running, () => handle<boolean>(() => isLibraryScanRunning()))
}
