/**
 * 资料库域的 core API。
 *
 * 契约：
 * 1. 模块内部抛 `LibraryError`，**只有 API 边界**把错误转成 `LibraryResult` 信封；
 * 2. 入参一律按 unknown 收窄，缺字段抛 `invalidArgument`；
 * 3. 扫描在 core 运行，进度通过 `library:progress` 单向推送；扫描本身耗时可能超过
 *    宿主 30s 的单次调用上限，渲染层用长任务通道（`coreJob`）调它。
 */
import {
  DEFAULT_MIN_FILE_SIZE_MB,
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
import { isTranslateLanguage } from '@common/types/plugin'
import type { TranslateLanguage } from '@common/types/setting/translateSetting'
import {
  readBoolean,
  readEnum,
  readNumber,
  readString,
  readStringArray,
  toSource
} from '@common/types/setting/shared'
import { cancelLibraryScan, isLibraryScanRunning, scanLibrary } from './libraryScan'
import { startLibraryScrape } from './libraryScrapeDispatch'
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

/** 内容语言：空串表示「未指定」，非法码一律收敛成空串 */
function readLanguage(source: Record<string, unknown>): TranslateLanguage | '' {
  const value = readString(source, 'language', '').trim()
  return isTranslateLanguage(value) ? value : ''
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
    // 缺字段时的缺省值与 schema 保持一致：NSFW 保护默认开、体积过滤默认 10、移动默认关
    nsfwProtection: readBoolean(draft, 'nsfwProtection', true),
    minFileSizeMb: readNumber(draft, 'minFileSizeMb', DEFAULT_MIN_FILE_SIZE_MB),
    localFirst: readBoolean(draft, 'localFirst', false),
    moveEnabled: readBoolean(draft, 'moveEnabled', false),
    moveDirectory: readString(draft, 'moveDirectory', ''),
    language: readLanguage(draft)
  }
}

export const libraryApi = {
  libraryList: (): Promise<LibraryResult<MediaLibrary[]>> =>
    handle<MediaLibrary[]>(() => listLibraries()),

  librarySave: (_ctx: unknown, payload: unknown): Promise<LibraryResult<MediaLibrary>> =>
    handle<MediaLibrary>(() => saveLibrary(readDraft(payload))),

  libraryRemove: (_ctx: unknown, payload: unknown): Promise<LibraryResult<boolean>> =>
    handle<boolean>(() => removeLibrary(readLibraryId(payload))),

  libraryScan: (_ctx: unknown, payload: unknown): Promise<LibraryResult<LibraryScanResult>> =>
    handle<LibraryScanResult>(() => scanLibrary(readLibraryId(payload))),

  libraryCancelScan: (): Promise<LibraryResult<boolean>> =>
    handle<boolean>(() => cancelLibraryScan()),

  libraryScrape: (_ctx: unknown, payload: unknown): Promise<LibraryResult<LibraryTaskResult>> =>
    handle<LibraryTaskResult>(() => startLibraryScrape(readLibraryId(payload))),

  /** 窗口挂载后用它恢复「扫描中」按钮状态：扫描在 core 跑，窗口重开也不会误判为空闲 */
  libraryRunning: (): Promise<LibraryResult<boolean>> =>
    handle<boolean>(() => isLibraryScanRunning())
}
