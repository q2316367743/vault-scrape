import { readBoolean, toSource } from './shared'

/** 文件行为：刮削过程中的文件操作开关 */
export interface SettingFile {
  /** 成功后移动文件 */
  moveAfterSuccess: boolean
  /** 失败后移动文件 */
  moveAfterFailure: boolean
  /** 成功后重命名文件 */
  renameAfterSuccess: boolean
  /** 删除空文件夹 */
  removeEmptyFolder: boolean
  /** 刮削软链接目录 */
  scrapeSymlinkDir: boolean
  /** 保存日志到文件 */
  saveLogToFile: boolean
}

export function buildSettingFile(): SettingFile {
  return {
    moveAfterSuccess: false,
    moveAfterFailure: false,
    renameAfterSuccess: false,
    removeEmptyFolder: false,
    scrapeSymlinkDir: false,
    saveLogToFile: false
  }
}

export function normalizeSettingFile(raw: unknown): SettingFile {
  const base = buildSettingFile()
  const source = toSource(raw)
  if (!source) return base
  return {
    moveAfterSuccess: readBoolean(source, 'moveAfterSuccess', base.moveAfterSuccess),
    moveAfterFailure: readBoolean(source, 'moveAfterFailure', base.moveAfterFailure),
    renameAfterSuccess: readBoolean(source, 'renameAfterSuccess', base.renameAfterSuccess),
    removeEmptyFolder: readBoolean(source, 'removeEmptyFolder', base.removeEmptyFolder),
    scrapeSymlinkDir: readBoolean(source, 'scrapeSymlinkDir', base.scrapeSymlinkDir),
    saveLogToFile: readBoolean(source, 'saveLogToFile', base.saveLogToFile)
  }
}
