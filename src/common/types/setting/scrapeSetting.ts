import { readBoolean, readNumber, readString, toSource } from './shared'

/** 刮削设置：节奏控制 */
export interface SettingScrape {
  /** 并发线程数 */
  concurrency: number
  /** 每次请求之间的延迟（秒） */
  requestDelay: number
  /** 连续刮削多少条后休息，0 表示不休息 */
  restAfterCount: number
  /** 休息时长（秒） */
  restDuration: number
  /**
   * 扫描完一个资料库后，是否自动为库里「尚未刮削」的影片排队刮削。
   *
   * 关掉后只能在资料库抽屉里手动点「刮削」，或在工作台里手动勾选。
   */
  autoScrapeAfterScan: boolean
  /** 剧照目录名（刮削结果内存放剧照的子目录名） */
  fanartDirName: string
}

export function buildSettingScrape(): SettingScrape {
  return {
    concurrency: 3,
    requestDelay: 1,
    restAfterCount: 50,
    restDuration: 60,
    autoScrapeAfterScan: true,
    fanartDirName: 'extrafanart'
  }
}

export function normalizeSettingScrape(raw: unknown): SettingScrape {
  const base = buildSettingScrape()
  const source = toSource(raw)
  if (!source) return base
  return {
    concurrency: readNumber(source, 'concurrency', base.concurrency, 1),
    requestDelay: readNumber(source, 'requestDelay', base.requestDelay),
    restAfterCount: readNumber(source, 'restAfterCount', base.restAfterCount),
    restDuration: readNumber(source, 'restDuration', base.restDuration),
    autoScrapeAfterScan: readBoolean(source, 'autoScrapeAfterScan', base.autoScrapeAfterScan),
    fanartDirName: readString(source, 'fanartDirName', base.fanartDirName)
  }
}
