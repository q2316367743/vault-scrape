/**
 * 媒体源地址（Jellyfin MediaSource / ImageInfo 的 URL 层）。
 *
 * 契约：
 * - 本模块只放纯类型与纯函数（渲染层要打包），**禁止引入 `node:*`**；
 * - 地址形如 `{媒体基地址}{存储ID}/{媒体ID}/{原始文件名}`，媒体基地址由 core 的回环
 *   HTTP 服务在启动时注入（见 `mediaBaseUrl` / `setMediaBaseUrl`）；
 *   媒体 ID 是 `media_source` / `media_image` 表的主键，URL 里只出现 ID，不暴露真实路径；
 * - `parseMediaUrl` 只做形状解析，是否越权、文件是否存在由 core 的处理器判定。
 */
import { isVideoExt } from '../scrape/keyword'

/** 媒体源归类：用于图标、封面判定与媒体地址的响应分支 */
export type MediaSourceKind = 'video' | 'image' | 'nfo' | 'other'

export const MEDIA_SOURCE_KINDS: readonly MediaSourceKind[] = ['video', 'image', 'nfo', 'other']

export const MEDIA_SOURCE_KIND_LABELS: Readonly<Record<MediaSourceKind, string>> = {
  video: '视频',
  image: '图片',
  nfo: '影片信息',
  other: '其他'
}

/**
 * 图片用途，对齐 Jellyfin 的 ImageType。
 *
 * `still` 是 Jellyfin 没有的用途，用来放刮削下来的剧照（`extrafanart/stillN.jpg`）：
 * 它排在封面兜底链的最后，与背景图区分开。
 */
export type MediaImageType = 'primary' | 'backdrop' | 'thumb' | 'still' | 'logo' | 'banner' | 'other'

export const MEDIA_IMAGE_TYPES: readonly MediaImageType[] = [
  'primary',
  'backdrop',
  'thumb',
  'still',
  'logo',
  'banner',
  'other'
]

export const MEDIA_IMAGE_TYPE_LABELS: Readonly<Record<MediaImageType, string>> = {
  primary: '主图',
  backdrop: '背景图',
  thumb: '缩略图',
  still: '剧照',
  logo: '徽标',
  banner: '横幅',
  other: '其他'
}

/**
 * 封面兜底顺序：主图 → 缩略图 → 背景图 → 剧照 → 其他。
 *
 * 读取侧按这个顺序、先条目自己再父目录条目，找第一张能当封面的图
 * （见 `mediaWall.coverUrlOf`）；只有主图一种用途时退化为旧行为。
 */
export const MEDIA_COVER_IMAGE_TYPE_ORDER: readonly MediaImageType[] = [
  'primary',
  'thumb',
  'backdrop',
  'still',
  'other'
]

/**
 * 媒体地址前缀（带尾斜杠）。
 *
 * 原 Electron 版本用 `storage://` 私有协议；插件没有自定义协议，改由 core 里的
 * 本机 HTTP 服务提供同一套「只认媒体 ID」的读取能力。服务的端口与一次性 token
 * 在启动后才确定，所以这里用可变前缀：core 启动时调 `setMediaBaseUrl()`，
 * 窗口侧在挂载前通过 `appInfo` 拿到同一个值。
 *
 * 地址形如 `http://127.0.0.1:<port>/p/<token>/{存储ID}/{媒体ID}/{文件名}`。
 */
let mediaBase = 'http://127.0.0.1/'

/** core 启动媒体服务后注入真实前缀（末尾自动补斜杠） */
export function setMediaBaseUrl(base: string): void {
  mediaBase = base.endsWith('/') ? base : `${base}/`
}

/** 当前媒体地址前缀（末尾带斜杠） */
export function mediaBaseUrl(): string {
  return mediaBase
}

/**
 * 媒体 ID：扫描出来的 `sha1(前缀 + 连接 ID + 路径)` 前 32 位十六进制，
 * 或刮削产物图落库时的 `randomUUID()`。两种形态都只含十六进制字符与连字符，
 * 不含路径分隔符，可以直接当媒体地址的一段路径。
 */
export const MEDIA_ID_PATTERN = /^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/

/** 一次媒体源索引的写入形状（对应 `media_source` 表） */
export interface MediaSourceItem {
  /** 媒体源 ID：由连接 ID + 路径哈希得来，**跨改名/移动保持稳定**（改名时按 ID 就地更新路径），媒体地址靠它定位 */
  id: string
  /** 所属条目（`media_item.id`） */
  itemId: string
  libraryId: string
  connectionId: string
  /** 连接内绝对路径 */
  path: string
  name: string
  extname: string
  mime: string
  size: number
  modifiedAt: number
  indexedAt: number
}

/** 一张图片的写入形状（对应 `media_image` 表） */
export interface MediaImageItem {
  id: string
  itemId: string
  libraryId: string
  type: MediaImageType
  connectionId: string
  /** 连接内绝对路径 */
  path: string
  width: number
  height: number
  createdAt: number
}

const IMAGE_EXTENSIONS: readonly string[] = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp',
  'avif',
  'svg'
]

/** 按 MIME 优先、扩展名兜底判定媒体类型 */
export function mediaSourceKindOf(mime: string, extname: string): MediaSourceKind {
  const ext = extname.toLowerCase()
  const type = mime.toLowerCase()
  if (isVideoExt(ext) || type.startsWith('video/')) return 'video'
  if (IMAGE_EXTENSIONS.includes(ext) || type.startsWith('image/')) return 'image'
  if (ext === 'nfo') return 'nfo'
  return 'other'
}

/** 媒体地址的解析结果 */
export interface MediaUrlParts {
  /** 存储 ID */
  connectionId: string
  /** 媒体 ID（`media_source.id` 或 `media_image.id`） */
  mediaId: string
  /** 原始文件名（已解码） */
  fileName: string
}

/**
 * 拼一条媒体地址。
 *
 * 文件名只参与展示与扩展名推断，真正的定位靠媒体 ID，因此这里对文件名做整体编码，
 * 允许出现空格、中文与括号等字符。
 */
export function buildMediaUrl(connectionId: string, mediaId: string, fileName: string): string {
  const name = fileName.trim().length > 0 ? fileName.trim() : 'media'
  return `${mediaBaseUrl()}${connectionId}/${mediaId}/${encodeURIComponent(name)}`
}

/** 解析媒体地址；形状不对或文件名解码失败时返回 null */
export function parseMediaUrl(url: string): MediaUrlParts | null {
  const base = mediaBaseUrl()
  const text = url.trim()
  if (!text.startsWith(base)) return null
  const rest = text.slice(base.length).split('?')[0]?.split('#')[0] ?? ''
  const parts = rest.split('/')
  const connectionId = parts[0] ?? ''
  const mediaId = parts[1] ?? ''
  const rawName = parts.slice(2).join('/')
  if (connectionId.length === 0 || mediaId.length === 0 || rawName.length === 0) return null
  let fileName: string
  try {
    fileName = decodeURIComponent(rawName)
  } catch {
    return null
  }
  return { connectionId, mediaId, fileName }
}
