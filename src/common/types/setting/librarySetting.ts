/**
 * 「资料库」设置组。
 *
 * 契约：
 * - 每种资料库类型各有一份「识别为影片的文件后缀」清单，扫描时按库的 `type` 取用；
 *   这里是唯一的后缀来源，扫描器不许再硬编码扩展名；
 * - 后缀一律**小写、不带点**（`mp4` 而不是 `.MP4`），非法项与重复项在归一化时丢掉；
 * - 某类型的清单被清空或全部非法时，回落该类型的默认清单——空清单会让扫描什么都扫不到，
 *   比恢复默认更危险，所以宁可回落；
 * - 设置文件可能被手工改坏，读取永不抛错。
 */
import type { LibraryType } from '../library'
import { LIBRARY_TYPES } from '../library'
import { readStringArray, toSource } from './shared'

/** 影视与剧集的默认后缀一样（剧集集文件也是视频文件） */
const DEFAULT_VIDEO_EXTENSIONS: readonly string[] = [
  'mp4',
  'mkv',
  'avi',
  'mov',
  'wmv',
  'flv',
  'webm',
  'ts',
  'm2ts',
  'mpg',
  'mpeg',
  'rmvb'
]

/** 每种资料库类型的默认后缀 */
export const DEFAULT_LIBRARY_EXTENSIONS: Readonly<Record<LibraryType, readonly string[]>> = {
  movie: DEFAULT_VIDEO_EXTENSIONS,
  tv: DEFAULT_VIDEO_EXTENSIONS
}

/** 单个后缀的合法形态：小写字母或数字，1~12 位 */
const EXTENSION_PATTERN = /^[a-z0-9]{1,12}$/

/** 单类型后缀数量上限，防脏数据撑爆设置文件 */
export const LIBRARY_EXTENSION_LIMIT = 64

export interface SettingLibrary {
  /** 每种资料库类型识别哪些后缀 */
  extensions: Record<LibraryType, string[]>
}

/** 后缀清洗：去空白、去前导点、转小写、丢弃非法与重复项、限量 */
export function normalizeExtensionList(
  input: readonly string[],
  fallback: readonly string[]
): string[] {
  const result: string[] = []
  for (const item of input) {
    const ext = item.trim().replace(/^\.+/, '').toLowerCase()
    if (!EXTENSION_PATTERN.test(ext) || result.includes(ext)) continue
    result.push(ext)
    if (result.length >= LIBRARY_EXTENSION_LIMIT) break
  }
  return result.length > 0 ? result : [...fallback]
}

export function buildSettingLibrary(): SettingLibrary {
  const extensions = {} as Record<LibraryType, string[]>
  for (const type of LIBRARY_TYPES) extensions[type] = [...DEFAULT_LIBRARY_EXTENSIONS[type]]
  return { extensions }
}

export function normalizeSettingLibrary(raw: unknown): SettingLibrary {
  const source = toSource(raw) ?? {}
  const extensionSource = toSource(source.extensions) ?? {}
  const extensions = {} as Record<LibraryType, string[]>
  for (const type of LIBRARY_TYPES) {
    const fallback = DEFAULT_LIBRARY_EXTENSIONS[type]
    extensions[type] = normalizeExtensionList(
      readStringArray(extensionSource, type, [...fallback]),
      fallback
    )
  }
  return { extensions }
}

/** 扫描入口：取某类型资料库的后缀清单（小写、无点） */
export function libraryExtensionsOf(setting: SettingLibrary, type: LibraryType): readonly string[] {
  return setting.extensions[type] ?? DEFAULT_LIBRARY_EXTENSIONS[type]
}
