/**
 * 刮削运行槽位（主进程单例）。
 *
 * 契约：
 * - **同一时刻只允许一个刮削在跑**：批量任务与「手动匹配」都从这里占位，避免同一批文件被两处同时改名 / 移动；
 * - 占位失败抛 `ScrapeError('busy')`，文案由错误码表统一给出；
 * - 槽位只保存取消句柄与归属标识，任务的进度真相仍以 sqlite 为准。
 */
import { ScrapeError } from '@common/types/scrape'

/** 运行中的刮削：批量任务的 taskId，或手动匹配的 `manual:<itemId>` */
export interface ScrapeRunHandle {
  taskId: string
  controller: AbortController
}

let running: ScrapeRunHandle | null = null

/** 当前运行的刮削；空闲返回 null */
export function currentRun(): ScrapeRunHandle | null {
  return running
}

/** 是否已有刮削在跑 */
export function isRunActive(): boolean {
  return running !== null
}

/** 占用槽位；已被占用时抛 `busy`。返回的 controller 用于取消 */
export function takeRunSlot(taskId: string): AbortController {
  if (running) throw new ScrapeError('busy')
  const controller = new AbortController()
  running = { taskId, controller }
  return controller
}

/** 释放槽位（调用方放在 finally 里） */
export function releaseRunSlot(): void {
  running = null
}
