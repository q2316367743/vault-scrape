/**
 * 系统文件 / 目录选择框桥。
 *
 * 契约：成功与「用户取消」都走 `DialogResult`，取消不算失败；
 * 宿主对单次能力调用有 30s 上限，用户在框里停留过久会失败，这里转成可读的中文提示。
 */
import type { DialogOpenOptions, DialogResult, DialogSaveOptions } from '@common/types/dialog'
import { runJob } from './job'

/** 宿主超时的文案（内部错误）→ 界面文案 */
const TIMEOUT_HINT = '选择超时，请重新选择。'

function describe(error: unknown): Error {
  const message = error instanceof Error ? error.message : ''
  if (/超时|timeout/i.test(message)) return new Error(TIMEOUT_HINT)
  return error instanceof Error ? error : new Error('打开选择框失败。')
}

async function run<T>(method: string, options: unknown): Promise<T> {
  try {
    return await runJob<T>(method, options)
  } catch (error) {
    throw describe(error)
  }
}

export const dialogApi = {
  /** 唤起系统「打开」框：`directory: true` 时选目录，否则选文件 */
  open: (options: DialogOpenOptions = {}): Promise<DialogResult> =>
    run<DialogResult>('dialog.open', options),

  /** 唤起系统「保存」框 */
  save: (options: DialogSaveOptions = {}): Promise<DialogResult> =>
    run<DialogResult>('dialog.save', options)
}

export type DialogApi = typeof dialogApi
