/**
 * 对话框与外部链接：core 侧的宿主能力薄封装。
 *
 * 契约：
 * - 返回形状与旧 Electron IPC 完全一致（`DialogResult`），渲染层不用改判断逻辑；
 * - 取消不算失败（`canceled: true`）；
 * - 注意宿主对能力调用有 30s 上限：用户在系统选择框里停留超过 30 秒会失败，
 *   渲染层把这种失败转成「选择超时，请重新选择」。
 */
import type { DialogFilter, DialogOpenOptions, DialogResult, DialogSaveOptions } from '@common/types/dialog'
import { host } from './host'

function readFilters(value: unknown): DialogFilter[] | undefined {
  if (!Array.isArray(value)) return undefined
  const filters: DialogFilter[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const source = item as Record<string, unknown>
    const name = typeof source.name === 'string' ? source.name.trim() : ''
    const extensions = Array.isArray(source.extensions)
      ? source.extensions.filter((ext): ext is string => typeof ext === 'string' && ext.trim() !== '')
      : []
    if (name === '' || extensions.length === 0) continue
    filters.push({ name, extensions })
  }
  return filters.length > 0 ? filters : undefined
}

export const dialogApi = {
  dialogOpen: async (_ctx: unknown, payload: unknown): Promise<DialogResult> => {
    const options = (payload ?? {}) as DialogOpenOptions
    const filters = readFilters(options.filters)
    const picked = await host().dialog.open({
      ...(options.title?.trim() ? { title: options.title.trim() } : {}),
      ...(options.defaultPath?.trim() ? { defaultPath: options.defaultPath.trim() } : {}),
      ...(filters ? { filters } : {}),
      ...(options.directory ? { directory: true } : {}),
      ...(options.multiple ? { multiple: true } : {})
    })
    return { canceled: picked.length === 0, filePaths: picked }
  },

  dialogSave: async (_ctx: unknown, payload: unknown): Promise<DialogResult> => {
    const options = (payload ?? {}) as DialogSaveOptions
    const filters = readFilters(options.filters)
    const picked = await host().dialog.save({
      ...(options.title?.trim() ? { title: options.title.trim() } : {}),
      ...(options.defaultPath?.trim() ? { defaultPath: options.defaultPath.trim() } : {}),
      ...(filters ? { filters } : {})
    })
    return picked === null
      ? { canceled: true, filePaths: [] }
      : { canceled: false, filePaths: [picked] }
  },

  /** 用系统默认程序打开 http(s) 链接 */
  openUrl: async (_ctx: unknown, payload: unknown): Promise<void> => {
    const url = typeof payload === 'string' ? payload.trim() : ''
    if (!/^https?:\/\//i.test(url)) return
    await host().opener.openUrl(url)
  }
}
