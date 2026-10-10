/**
 * 刮削资源的落盘计划：把插件给的 `PluginAsset` 映射成「文件名 + 相对路径」。
 *
 * 契约：
 * - 插件不下载，宿主按下载开关决定实际下载哪些 kind；
 * - 落盘位置一律在影片目录内（图片与影片同目录），剧照放 `extrafanart/`；
 * - `naming.assetNaming === 'fixed'`（默认）时用 Jellyfin 的固定名：
 *   `poster.jpg` / `backdrop.jpg` / `thumb.jpg` / `banner.jpg` / `logo.png` /
 *   `extrafanart/fanart1.jpg`…；
 * - `naming.assetNaming === 'movie'` 时统一加 `<视频基础名>-` 前缀；
 * - `keepXxx` 为真且目标已存在时跳过（由主进程用 `exists` 判断）。
 */
import type { PluginAsset, PluginAssetKind } from '../plugin'
import type { SettingDownload, SettingNaming } from '../setting'

/** 附属文件命名上下文 */
export interface ScrapeAssetContext {
  /** 视频文件最终的基础名（不含扩展名） */
  videoBase: string
  naming: SettingNaming
  /** 剧照子目录名（来自 scrape.fanartDirName） */
  fanartDirName: string
}

/** 一条资源的落盘位置（相对影片目录） */
export interface ScrapeAssetFile {
  name: string
  relativePath: string
}

const IMAGE_EXTENSIONS: readonly string[] = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif']
const VIDEO_EXTENSIONS: readonly string[] = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'flv', 'ts']

/** 该资源是否被下载选项勾选；`banner` / `logo` 没有开关，插件给了就下 */
export function downloadFlagOf(download: SettingDownload, kind: PluginAssetKind): boolean {
  if (kind === 'thumb') return download.downloadThumb
  if (kind === 'poster') return download.downloadPoster
  if (kind === 'fanart') return download.downloadFanart
  if (kind === 'still') return download.downloadStill
  if (kind === 'trailer') return download.downloadTrailer
  return true
}

/** 该资源是否保留已有文件（为真且目标存在时跳过下载） */
export function keepFlagOf(download: SettingDownload, kind: PluginAssetKind): boolean {
  if (kind === 'thumb') return download.keepThumb
  if (kind === 'poster') return download.keepPoster
  if (kind === 'fanart') return download.keepFanart
  if (kind === 'still') return download.keepStill
  if (kind === 'trailer') return download.keepTrailer
  return true
}

/** 被下载选项勾选的 kind 列表（顺序即收集顺序） */
export function enabledAssetKinds(download: SettingDownload): PluginAssetKind[] {
  return (['thumb', 'poster', 'fanart', 'banner', 'logo', 'still', 'trailer'] as const).filter((kind) =>
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

/** 固定命名表：图片基名（不含扩展名）；`still` 另有子目录 */
const FIXED_BASE_NAMES: Readonly<Record<'thumb' | 'poster' | 'fanart' | 'banner' | 'logo', string>> = {
  thumb: 'thumb',
  poster: 'poster',
  fanart: 'backdrop',
  banner: 'banner',
  logo: 'logo'
}

/** 解析一条资源的文件名与相对路径；`index` 是同类资源中的序号（从 1 开始） */
export function resolveAssetFile(
  asset: PluginAsset,
  index: number,
  context: ScrapeAssetContext
): ScrapeAssetFile {
  return resolveAssetName(asset.kind, asset.url, index, context)
}

/**
 * 同上，但按 kind + 来源名解析。
 *
 * `source` 是插件资源的 URL，或**本地已有图片的文件名**（`localFirst` 整理本地图片时复用同一套命名）。
 */
export function resolveAssetName(
  kind: PluginAssetKind,
  source: string,
  index: number,
  context: ScrapeAssetContext
): ScrapeAssetFile {
  const base = context.videoBase.trim()
  const useMovieStyle = context.naming.assetNaming === 'movie'
  const prefix = useMovieStyle && base.length > 0 ? `${base}-` : ''
  const imageExt = assetExtension(source, kind === 'logo' ? 'png' : 'jpg')
  const trailerExt = assetExtension(source, 'mp4')

  if (kind === 'still') {
    const name = `${prefix}fanart${index}.${imageExt}`
    const folderName = context.fanartDirName.trim() || 'extrafanart'
    return { name, relativePath: `${folderName}/${name}` }
  }
  if (kind === 'trailer') {
    const name = `${prefix}trailer${index > 1 ? index : ''}.${trailerExt}`
    return { name, relativePath: name }
  }
  const name = `${prefix}${FIXED_BASE_NAMES[kind]}.${imageExt}`
  return { name, relativePath: name }
}
