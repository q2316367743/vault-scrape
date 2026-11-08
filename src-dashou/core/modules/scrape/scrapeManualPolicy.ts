/**
 * 手动匹配的内存态与执行策略（`scrapeRunner` 的配套小模块）。
 *
 * 手动匹配 = 一条「强制候选」的单文件任务：它跳过 `search` 与候选挑选，并且**忽略本地优先与
 * 保留已有图片**，保证用户这次选的元数据与封面真正落盘。
 *
 * 为什么单独一个文件：这三件事（内存表 / 任务名前缀 / 策略改写）都被 `scrapeRunner` 的
 * 调度与 `resume` 判定复用，放一起免得 `scrapeRunner.ts` 顶到单文件 500 行上限（RL-05）。
 *
 * 注意：`taskForced` 只存在内存里，应用重启后为空——这正是「重启后不允许继续手动匹配任务」的原因。
 */
import { ScrapeError } from '@common/types/scrape'
import type { SettingDownload } from '@common/types/setting'
import type {
  ScrapeForcedMatch,
  ScrapeLibraryPolicy,
  ScrapeSettingsSnapshot
} from './scrapeJobTypes'

/** 手动匹配任务的名字前缀：重启后靠它识别这类任务 */
export const MANUAL_MATCH_TASK_PREFIX = '手动匹配 '

/** 手动匹配时强制关闭的「保留已有图片」，让新选的封面与剧照覆盖旧图 */
const CLEAR_KEEP: Pick<
  SettingDownload,
  'keepThumb' | 'keepPoster' | 'keepFanart' | 'keepStill' | 'keepTrailer'
> = {
  keepThumb: false,
  keepPoster: false,
  keepFanart: false,
  keepStill: false,
  keepTrailer: false
}

const taskForced = new Map<string, ScrapeForcedMatch>()

export function rememberForced(taskId: string, forced: ScrapeForcedMatch): void {
  taskForced.set(taskId, forced)
}

export function forcedOf(taskId: string): ScrapeForcedMatch | undefined {
  return taskForced.get(taskId)
}

export function forgetForced(taskId: string): void {
  taskForced.delete(taskId)
}

/**
 * 「继续」前的守卫：手动匹配任务靠内存里的强制候选才能保证还是用户选的那一条，
 * 应用重启后这份内存态已丢，继续下去会退化成按关键字自动匹配，所以直接拒绝。
 */
export function assertManualTaskResumable(taskId: string, taskName: string): void {
  if (forcedOf(taskId) || !taskName.startsWith(MANUAL_MATCH_TASK_PREFIX)) return
  throw new ScrapeError(
    'invalidArgument',
    '手动匹配的任务在应用重启后无法继续，请在详情页重新手动匹配'
  )
}

/** 手动匹配的语义就是「用我选的这条」：不读本地、也不保留旧图 */
export function applyForcedMatch(
  policy: ScrapeLibraryPolicy,
  settings: ScrapeSettingsSnapshot,
  forced: ScrapeForcedMatch | undefined
): { policy: ScrapeLibraryPolicy; settings: ScrapeSettingsSnapshot } {
  if (!forced) return { policy, settings }
  return {
    policy: { ...policy, localFirst: false },
    settings: { ...settings, download: { ...settings.download, ...CLEAR_KEEP } }
  }
}
