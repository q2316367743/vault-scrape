import { readBoolean, toSource } from './shared'

/** 文件行为：刮削过程中的文件操作开关 */
export interface SettingFile {
  /** 删除空文件夹 */
  removeEmptyFolder: boolean
  /** 刮削软链接目录 */
  scrapeSymlinkDir: boolean
  /** 保存日志到文件 */
  saveLogToFile: boolean
}

export function buildSettingFile(): SettingFile {
  return {
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
    removeEmptyFolder: readBoolean(source, 'removeEmptyFolder', base.removeEmptyFolder),
    scrapeSymlinkDir: readBoolean(source, 'scrapeSymlinkDir', base.scrapeSymlinkDir),
    saveLogToFile: readBoolean(source, 'saveLogToFile', base.saveLogToFile)
  }
}
