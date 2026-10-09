import { ipcRenderer } from 'electron'
import type { DialogOpenOptions, DialogResult, DialogSaveOptions } from '@common/types/dialog'
import { DialogChannels } from './dialogChannels'

/**
 * 系统文件/目录选择框桥。
 *
 * 契约：成功与「用户取消」都走 `DialogResult`，取消不算失败；
 * 主进程抛错时 promise 会 reject，由调用方 try/catch 决定怎么提示。
 */
export const dialogApi = {
  /** 唤起系统「打开」框：`directory: true` 时选目录，否则选文件 */
  open: (options: DialogOpenOptions = {}): Promise<DialogResult> =>
    ipcRenderer.invoke(DialogChannels.open, options),

  /** 唤起系统「保存」框 */
  save: (options: DialogSaveOptions = {}): Promise<DialogResult> =>
    ipcRenderer.invoke(DialogChannels.save, options)
}

export type DialogApi = typeof dialogApi
