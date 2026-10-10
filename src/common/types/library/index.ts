/**
 * 资料库（Jellyfin/Emby 意义上的 library）。
 *
 * 契约：
 * - 资料库自己持有配置：一组媒体目录（`paths`）、自己的刮削器（`scrapers`）与扫描/刮削选项；
 *   存储（连接）只负责怎么连，**不再配置刮削器**；
 * - 一个存储连接可以出现在多个资料库里，也可以在一个资料库里出现多次；
 * - `path` 一律是**连接内绝对路径**（`/` 表示连接根），不是本机路径；
 * - `type` 是资料库类型：目前只落地「影视」（`movie`），书籍等类型只在类型层预留；
 * - `scrapers` **可以为空**：空数组表示这个库不刮削，扫描只负责索引；
 *   非空时全部必须是「插件 ID + 已启用」的刮削器，运行时不可用会单独报错；
 * - 扫描是「递归遍历每个目录 + 按路径 upsert 条目 + 清理磁盘上已消失的条目」；
 *   刮削只针对库内**尚未刮削**的条目；
 * - 删除库只删配置与库内条目：磁盘文件不动。
 */
import type { ScrapeTaskSnapshot } from '../scrape'

/** 资料库类型：新类型要同时补 `LIBRARY_TYPE_LABELS` 与 `DEFAULT_LIBRARY_EXTENSIONS` */
export type LibraryType = 'movie'

export const LIBRARY_TYPES: readonly LibraryType[] = ['movie']

export const LIBRARY_TYPE_LABELS: Readonly<Record<LibraryType, string>> = {
  movie: '影视'
}

/** 资料库类型的中文名；脏数据回落类型本身 */
export function libraryTypeLabel(type: LibraryType): string {
  return LIBRARY_TYPE_LABELS[type] ?? type
}

/** 图片落盘位置：与影片同目录，或应用数据目录 */
export type LibraryImageSaveMode = 'media' | 'appdata'

export const LIBRARY_IMAGE_SAVE_MODES: readonly LibraryImageSaveMode[] = ['media', 'appdata']

export const LIBRARY_IMAGE_SAVE_MODE_LABELS: Readonly<Record<LibraryImageSaveMode, string>> = {
  media: '与影片同目录',
  appdata: '应用数据目录'
}

/** 资料库里的一个媒体目录 */
export interface MediaLibraryPath {
  id: string
  connectionId: string
  /** 连接内绝对路径，`/` 表示连接根 */
  path: string
}

/** 新建 / 编辑资料库时提交的一个目录 */
export interface MediaLibraryPathDraft {
  connectionId: string
  path: string
}

/** 资料库配置 */
export interface MediaLibrary {
  id: string
  name: string
  /** 库类型；目前只有「影视」 */
  type: LibraryType
  /** 该库使用的刮削器插件 ID；**空数组表示不刮削** */
  scrapers: string[]
  /** 媒体目录（至少一个） */
  paths: MediaLibraryPath[]
  /** 该库的影片默认开启 NSFW 保护 */
  nsfwProtection: boolean
  /** 刮削完成后把元数据写成同目录的 `movie.nfo` */
  writeNfo: boolean
  /** 刮削完成后按插件标题重命名文件 */
  renameEnabled: boolean
  /** 刮削完成后把文件移动到 `moveDirectory` */
  moveEnabled: boolean
  /** 移动目标目录（连接内路径；用于该库的多个连接时按目标归属的连接解释） */
  moveDirectory: string
  /** 图片落盘位置 */
  imageSaveMode: LibraryImageSaveMode
  /** 上次扫描完成时间；0 表示从未扫描 */
  lastScanAt: number
  /** 上次刮削任务启动时间；0 表示从未刮削 */
  lastScrapeAt: number
  createdAt: number
  updatedAt: number
}

/** 新建 / 编辑资料库的入参；`id` 缺省表示新建 */
export interface MediaLibraryDraft {
  id?: string
  name: string
  type: LibraryType
  scrapers: string[]
  paths: MediaLibraryPathDraft[]
  nsfwProtection: boolean
  writeNfo: boolean
  renameEnabled: boolean
  moveEnabled: boolean
  moveDirectory: string
  imageSaveMode: LibraryImageSaveMode
}

/** 墙面筛选与列表展示用的库摘要（计数与封面由影视墙读模型给出） */
export interface MediaLibrarySummary extends MediaLibrary {
  /** 该库在墙上的影片数 */
  videoCount: number
  /** 其中已刮削的数量 */
  scrapedCount: number
  /**
   * 库卡片封面拼贴用的海报地址（`storage://`），最多 4 张、按最近添加排序。
   *
   * 影片一个封面都没有时是空数组，渲染层回落到文字卡片。
   */
  coverUrls: string[]
}

/** 扫描进度事件：只是增量提示，最终结果以 `library:scan` 的返回值为准 */
export interface LibraryProgressEvent {
  libraryId: string
  phase: 'scan'
  /** 已扫描并成功列出的目录数 */
  scannedDirs: number
  /** 累计列出的文件数 */
  indexedFiles: number
  /** 当前正在扫描的目录（连接内路径） */
  currentPath: string
  finished: boolean
  cancelled: boolean
}

/** 一次资料库扫描的结果 */
export interface LibraryScanResult {
  library: MediaLibrary
  /** 本次扫描写入/更新的媒体源数 */
  indexedFiles: number
  /** 其中的视频数 */
  indexedVideos: number
  /** 被清掉的条目数（磁盘上已删除的文件） */
  removedItems: number
  /** 读失败而被跳过的目录数 */
  skippedDirs: number
  /** 扫描结束后仍未刮削的视频数 */
  pending: number
  /** 需要在界面上提示的补充说明（截断、跳过目录等），正常时为空串 */
  message: string
  /** 扫描后自动启动的刮削任务；没启动时为 null */
  autoScrape: ScrapeTaskSnapshot | null
  /** 没有自动刮削的原因（中文），自动刮削成立时为空串 */
  autoScrapeSkipped: string
}

/** 「刮削已扫描的影视」的结果：任务已建好，进度去任务本身看 */
export interface LibraryTaskResult {
  taskId: string
  total: number
}

export interface LibraryScanRequest {
  libraryId: string
}

export interface LibraryScrapeRequest {
  libraryId: string
}

export interface LibrarySaveRequest {
  draft: MediaLibraryDraft
}

export interface LibraryRemoveRequest {
  libraryId: string
}

export * from './error'
export * from './result'
