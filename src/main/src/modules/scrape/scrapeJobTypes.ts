/**
 * 刮削单文件流水线的公共形状：任务上下文、设置快照与资料库策略。
 *
 * 拆出来的理由：编排（`scrapeFileJob`）、收集与落盘（`scrapeJobPlan`）、
 * 写回（`scrapeJobApply`）三部分共用同一份上下文定义，放在这里可以避免循环依赖。
 */
import type { ScrapeFileStatus } from '@common/types/scrape'
import type {
  SettingDownload,
  SettingFile,
  SettingNaming,
  SettingScrape
} from '@common/types/setting'
import type { FileClient } from '$/modules/file/FileClient'
import type { ScrapeRunLog } from './scrapeLogFile'

/** 参与刮削的插件（顺序即插件页顺序） */
export interface ScrapePluginRef {
  id: string
  name: string
}

/** 任务启动时冻结的设置快照：任务运行期间改设置不影响已启动的任务 */
export interface ScrapeSettingsSnapshot {
  scrape: SettingScrape
  download: SettingDownload
  naming: SettingNaming
  file: SettingFile
}

/**
 * 任务启动时冻结的资料库策略。
 *
 * 刮削产物的形态是全库统一的固定规范（文件夹 + 同名视频 + NFO + 同目录图片），
 * 所以这里只有「移动到哪里」和「是否优先本地」两个变量。
 */
export interface ScrapeLibraryPolicy {
  libraryId: string
  /** 优先读取本地 NFO 与本地图片，只从互联网补缺失的信息 */
  localFirst: boolean
  moveEnabled: boolean
  moveDirectory: string
  /** 资料库的媒体目录（连接内绝对路径）：清理空目录时绝不删它们 */
  libraryRoots: readonly string[]
}

export interface ScrapeJobContext {
  taskId: string
  connectionId: string
  policy: ScrapeLibraryPolicy
  dirPath: string
  entry: {
    /** 媒体条目 ID：元数据与图片写回的目标 */
    itemId: string
    path: string
    name: string
    keyword: string
    num: string
  }
  plugins: readonly ScrapePluginRef[]
  settings: ScrapeSettingsSnapshot
  client: FileClient
  signal: AbortSignal
  log: ScrapeRunLog
}

export interface ScrapeJobOutcome {
  status: ScrapeFileStatus
  pluginId: string
  title: string
  message: string
  /**
   * 本次结束时文件在连接内的最终路径。
   *
   * 未发生移动时就是扫描时的原路径；媒体源靠它就地更新。
   */
  finalPath: string
}
