/**
 * 媒体源地址（Jellyfin MediaSource / ImageInfo 的 URL 层）。
 *
 * 契约：
 * - 本模块只放纯类型与纯函数（渲染层要打包），**禁止引入 `node:*`**；
 * - 私有协议形如 `storage://{存储ID}/{媒体ID}/{原始文件名}`，
 *   媒体 ID 是 `media_source` / `media_image` 表的主键，URL 里只出现 ID，不暴露真实路径；
 * - `parseMediaUrl` 只做形状解析，是否越权、文件是否存在由主进程处理器判定。
 */
import { isVideoExt } from '../scrape/keyword'

/** 媒体源归类：用于图标、封面判定与私有协议的响应分支 */
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

/** 私有协议名（Electron 自定义协议，渲染层可直接用于 img/video 的 src） */
export const MEDIA_SCHEME = 'storage'

export const MEDIA_URL_PREFIX = `${MEDIA_SCHEME}://`

/**
 * 媒体 ID：扫描出来的 `sha1(前缀 + 连接 ID + 路径)` 前 32 位十六进制，
 * 或刮削产物图落库时的 `randomUUID()`。两种形态都只含十六进制字符与连字符，
 * 不含路径分隔符，可以直接当私有协议的一段路径。
 */
export const MEDIA_ID_PATTERN = /^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/

/** 一次媒体源索引的写入形状（对应 `media_source` 表） */
export interface MediaSourceItem {
  /** 媒体源 ID：由连接 ID + 路径哈希得来，**跨改名/移动保持稳定**（改名时按 ID 就地更新路径），私有协议靠它定位 */
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

/** 私有协议的解析结果 */
export interface MediaUrlParts {
  /** 存储 ID（standard 协议会把 host 归一化为小写） */
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
  return `${MEDIA_URL_PREFIX}${connectionId}/${mediaId}/${encodeURIComponent(name)}`
}

/** 解析媒体地址；形状不对或文件名解码失败时返回 null */
export function parseMediaUrl(url: string): MediaUrlParts | null {
  const text = url.trim()
  if (!text.startsWith(MEDIA_URL_PREFIX)) return null
  const rest = text.slice(MEDIA_URL_PREFIX.length).split('?')[0]?.split('#')[0] ?? ''
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
