/**
 * 刮削资源的落盘计划：把插件给的 `PluginAsset` 映射成「文件名 + 相对路径」。
 *
 * 契约：
 * - 插件不下载，宿主按下载开关决定实际下载哪些 kind；
 * - `keepXxx` 为真且目标已存在时跳过（由主进程用 `exists` 判断）；
 * - 「成功后不重命名」时附属文件强制与视频同名（`forceMovieStyle`），
 *   否则按 `naming.assetNaming` 决定固定命名还是跟随影片文件名；
 * - 剧照落在 `path.fanartDirName` 子目录，多集作品再加一层 `S{集数}`。
 */
import type { PluginAsset, PluginAssetKind } from '../plugin'
import type { SettingDownload, SettingNaming } from '../setting'

/** 附属文件命名上下文 */
export interface ScrapeAssetContext {
  /** 视频文件最终的基础名（不含扩展名） */
  videoBase: string
  /** 未重命名时强制附属文件与视频同名 */
  forceMovieStyle: boolean
  naming: SettingNaming
  /** 剧照子目录名（来自 path.fanartDirName） */
  fanartDirName: string
}

/** 一条资源的落盘位置（相对刮削目录） */
export interface ScrapeAssetFile {
  name: string
  relativePath: string
}

const IMAGE_EXTENSIONS: readonly string[] = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif']
const VIDEO_EXTENSIONS: readonly string[] = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'flv', 'ts']

/** 该资源是否被下载选项勾选 */
export function downloadFlagOf(download: SettingDownload, kind: PluginAssetKind): boolean {
  if (kind === 'thumb') return download.downloadThumb
  if (kind === 'poster') return download.downloadPoster
  if (kind === 'fanart') return download.downloadFanart
  if (kind === 'still') return download.downloadStill
  return download.downloadTrailer
}

/** 该资源是否保留已有文件（为真且目标存在时跳过下载） */
export function keepFlagOf(download: SettingDownload, kind: PluginAssetKind): boolean {
  if (kind === 'thumb') return download.keepThumb
  if (kind === 'poster') return download.keepPoster
  if (kind === 'fanart') return download.keepFanart
  if (kind === 'still') return download.keepStill
  return download.keepTrailer
}

/** 被下载选项勾选的 kind 列表 */
export function enabledAssetKinds(download: SettingDownload): PluginAssetKind[] {
  return (['thumb', 'poster', 'fanart', 'still', 'trailer'] as const).filter((kind) =>
    downloadFlagOf(download, kind)
  )
}

/** 从 URL 推断扩展名；不在允许表内时用兜底值 */
export function assetExtension(url: string, fallback: string): string {
  const path = url.split('?')[0]?.split('#')[0] ?? ''
  const index = path.lastIndexOf('.')
  if (index < 0 || index === path.length - 1) return fallback
  const ext = path.slice(index + 1).toLowerCase()
  if (IMAGE_EXTENSIONS.includes(ext)) return ext === 'jpeg' ? 'jpg' : ext
  if (VIDEO_EXTENSIONS.includes(ext)) return ext
  return fallback
}

/** 解析一条资源的文件名与相对路径；`index` 是同类资源中的序号（从 1 开始） */
export function resolveAssetFile(
  asset: PluginAsset,
  index: number,
  context: ScrapeAssetContext
): ScrapeAssetFile {
  const useMovieStyle = context.forceMovieStyle || context.naming.assetNaming === 'movie'
  const base = context.videoBase.trim()
  const prefix = useMovieStyle && base.length > 0 ? `${base}-` : ''
  const imageExt = assetExtension(asset.url, 'jpg')
  const trailerExt = assetExtension(asset.url, 'mp4')

  let name: string
  if (asset.kind === 'thumb') name = `${prefix}thumb.${imageExt}`
  else if (asset.kind === 'poster') name = `${prefix}poster.${imageExt}`
  else if (asset.kind === 'fanart') name = `${prefix}fanart.${imageExt}`
  else if (asset.kind === 'still') name = `${prefix}still${index}.${imageExt}`
  else name = `${prefix}trailer${index > 1 ? index : ''}.${trailerExt}`

  if (asset.kind !== 'still') return { name, relativePath: name }

  const folderName = context.fanartDirName.trim() || 'extrafanart'
  const episodeIndex = asset.episode?.index ?? 0
  const folder = episodeIndex > 1 ? `${folderName}/S${episodeIndex}` : folderName
  return { name, relativePath: `${folder}/${name}` }
}
