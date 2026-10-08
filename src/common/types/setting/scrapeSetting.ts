import { readNumber, toSource } from './shared'

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
}

export function buildSettingScrape(): SettingScrape {
  return {
    concurrency: 3,
    requestDelay: 1,
    restAfterCount: 50,
    restDuration: 60
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
    restDuration: readNumber(source, 'restDuration', base.restDuration)
  }
}
