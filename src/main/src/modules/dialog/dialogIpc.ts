import {
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type SaveDialogOptions
} from 'electron'
import type { DialogFilter, DialogOpenOptions, DialogResult } from '@common/types/dialog'
import { readBoolean, readString, readStringArray, toSource } from '@common/types/setting/shared'
import { DialogChannels } from '~/modules/dialog/dialogChannels'

/** 两个通道共用的可选项：字段与 DialogOpenOptions / DialogSaveOptions 保持一致 */
type PickedOptions = Pick<DialogOpenOptions, 'title' | 'buttonLabel' | 'defaultPath' | 'filters'>

/** 从 IPC 事件反查发起调用的窗口：让选择框挂在正确的窗口上 */
function senderWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

/** 过滤器逐项校验：名字或扩展名缺失的项直接丢弃，避免脏数据传给 Electron 抛错 */
function readFilters(source: Record<string, unknown>): DialogFilter[] | undefined {
  const raw = source.filters
  if (!Array.isArray(raw)) return undefined
  const filters: DialogFilter[] = []
  for (const item of raw) {
    const filter = toSource(item)
    if (!filter) continue
    const name = readString(filter, 'name', '').trim()
    const extensions = readStringArray(filter, 'extensions', [])
      .map((extension) => extension.trim())
      .filter((extension) => extension !== '')
    if (name === '' || extensions.length === 0) continue
    filters.push({ name, extensions })
  }
  return filters.length > 0 ? filters : undefined
}

/** 只保留有值的可选项：空串会让 Electron 用空标题/空路径，不如不传 */
function readCommonOptions(payload: unknown): PickedOptions {
  const source = toSource(payload) ?? {}
  const title = readString(source, 'title', '').trim()
  const buttonLabel = readString(source, 'buttonLabel', '').trim()
  const defaultPath = readString(source, 'defaultPath', '').trim()
  const filters = readFilters(source)
  return {
    ...(title === '' ? {} : { title }),
    ...(buttonLabel === '' ? {} : { buttonLabel }),
    ...(defaultPath === '' ? {} : { defaultPath }),
    ...(filters ? { filters } : {})
  }
}

/** 选文件还是选目录由 properties 决定，其余可选项通用 */
function buildOpenOptions(payload: unknown): OpenDialogOptions {
  const source = toSource(payload) ?? {}
  const directory = readBoolean(source, 'directory', false)
  return {
    ...readCommonOptions(payload),
    properties: directory ? ['openDirectory'] : ['openFile']
  }
}

/** dialog 域 IPC 注册：只做「唤起系统选择框」，不理解业务语义 */
export function registerDialogIpc(): void {
  ipcMain.handle(DialogChannels.open, async (event, payload: unknown): Promise<DialogResult> => {
    const win = senderWindow(event)
    const options = buildOpenOptions(payload)
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return { canceled: result.canceled, filePaths: result.filePaths }
  })

  ipcMain.handle(DialogChannels.save, async (event, payload: unknown): Promise<DialogResult> => {
    const win = senderWindow(event)
    const options: SaveDialogOptions = readCommonOptions(payload)
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    // 保存框只会返回单个 filePath，统一成数组形状给渲染层
    return { canceled: result.canceled, filePaths: result.filePath ? [result.filePath] : [] }
  })
}
