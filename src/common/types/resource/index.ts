/**
 * 资源索引与私有协议的公共形状。
 *
 * 契约：
 * - 本模块只放纯类型与纯函数（渲染层要打包），**禁止引入 `node:*`**；
 *   资源 ID 的生成需要 `node:crypto`，放在主进程 `modules/resource/resourceIndex.ts`；
 * - 私有协议形如 `storage://{存储ID}/{资源ID}/{原始文件名}.{原始拓展名}`，
 *   索引表按 `连接 + 绝对路径` 定位文件，URL 里只出现 ID，不暴露真实路径；
 * - `parseResourceUrl` 只做形状解析，是否越权、文件是否存在由主进程处理器判定。
 */
import { isVideoExt } from '../scrape/keyword'

/** 资源类型：用于媒体库分组与图标展示 */
export type ResourceKind = 'video' | 'image' | 'nfo' | 'other'

export const RESOURCE_KINDS: readonly ResourceKind[] = ['video', 'image', 'nfo', 'other']

export const RESOURCE_KIND_LABELS: Readonly<Record<ResourceKind, string>> = {
  video: '视频',
  image: '图片',
  nfo: '影片信息',
  other: '其他'
}

/** 私有协议名（Electron 自定义协议，渲染层可直接用于 img/video 的 src） */
export const RESOURCE_SCHEME = 'storage'

export const RESOURCE_URL_PREFIX = `${RESOURCE_SCHEME}://`

/** 资源索引表的一行（对应 resource 表） */
export interface ResourceItem {
  /** 资源 ID：由「存储 ID + 连接内绝对路径」哈希得到，稳定且与文件名无关 */
  id: string
  /** 存储 ID（连接 ID） */
  connectionId: string
  /** 建立索引时所在的目录（连接内路径，即媒体库根目录） */
  dirPath: string
  /** 连接内绝对路径 */
  path: string
  name: string
  extname: string
  mime: string
  size: number
  modifiedAt: number
  kind: ResourceKind
  /** 建立/更新索引的时间戳 */
  indexedAt: number
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

/** 按 MIME 优先、扩展名兜底判定资源类型 */
export function resourceKindOf(mime: string, extname: string): ResourceKind {
  const ext = extname.toLowerCase()
  const type = mime.toLowerCase()
  if (isVideoExt(ext) || type.startsWith('video/')) return 'video'
  if (IMAGE_EXTENSIONS.includes(ext) || type.startsWith('image/')) return 'image'
  if (ext === 'nfo') return 'nfo'
  return 'other'
}

/** 私有协议的解析结果 */
export interface ResourceUrlParts {
  /** 存储 ID（standard 协议会把 host 归一化为小写） */
  connectionId: string
  /** 资源 ID */
  resourceId: string
  /** 原始文件名（已解码） */
  fileName: string
}

/**
 * 拼一条资源地址。
 *
 * 文件名只参与展示与扩展名推断，真正的定位靠资源 ID，因此这里对文件名做整体编码，
 * 允许出现空格、中文与括号等字符。
 */
export function buildResourceUrl(connectionId: string, resourceId: string, fileName: string): string {
  const name = fileName.trim().length > 0 ? fileName.trim() : 'resource'
  return `${RESOURCE_URL_PREFIX}${connectionId}/${resourceId}/${encodeURIComponent(name)}`
}

/** 解析资源地址；形状不对或文件名解码失败时返回 null */
export function parseResourceUrl(url: string): ResourceUrlParts | null {
  const text = url.trim()
  if (!text.startsWith(RESOURCE_URL_PREFIX)) return null
  const rest = text.slice(RESOURCE_URL_PREFIX.length).split('?')[0]?.split('#')[0] ?? ''
  const parts = rest.split('/')
  const connectionId = parts[0] ?? ''
  const resourceId = parts[1] ?? ''
  const rawName = parts.slice(2).join('/')
  if (connectionId.length === 0 || resourceId.length === 0 || rawName.length === 0) return null
  let fileName: string
  try {
    fileName = decodeURIComponent(rawName)
  } catch {
    return null
  }
  return { connectionId, resourceId, fileName }
}
