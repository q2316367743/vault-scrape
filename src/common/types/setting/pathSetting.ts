import { readString, toSource } from './shared'

/** 目录与路径：全部为输入框，允许留空表示使用默认位置 */
export interface SettingPath {
  /** 演员头像目录 */
  actorAvatarDir: string
  /** 成功输出目录 */
  successOutputDir: string
  /** 失败输出目录 */
  failedOutputDir: string
  /** 剧照目录名（刮削结果内的子目录名） */
  fanartDirName: string
}

export function buildSettingPath(): SettingPath {
  return {
    actorAvatarDir: '',
    successOutputDir: '',
    failedOutputDir: '',
    fanartDirName: 'extrafanart'
  }
}

export function normalizeSettingPath(raw: unknown): SettingPath {
  const base = buildSettingPath()
  const source = toSource(raw)
  if (!source) return base
  return {
    actorAvatarDir: readString(source, 'actorAvatarDir', base.actorAvatarDir),
    successOutputDir: readString(source, 'successOutputDir', base.successOutputDir),
    failedOutputDir: readString(source, 'failedOutputDir', base.failedOutputDir),
    fanartDirName: readString(source, 'fanartDirName', base.fanartDirName)
  }
}
