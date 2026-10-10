/**
 * 存储页媒体预览的地址契约。
 *
 * 背景：`storage://` 媒体地址只认媒体 ID（影视墙入库的内容），而存储页要预览的是
 * 「连接内任意路径」的文件，因此这里额外定义一条只读的路径形式：
 *
 * `storage://{连接ID}/path/{encodeURIComponent(连接内路径)}`（可选 `?v=修改时间`）
 *
 * 契约：
 * - 地址由本文件的纯函数构造，三端共用；渲染层不拼字符串；
 * - 主进程收到后必须复核：连接存在、路径经 normalizeRemotePath 归一后仍落在连接根内，
 *   越界、不存在、不是文件一律 404 —— 渲染层拿不到任何越权内容；
 * - `?v=` 只用于换文件后绕过缓存，内容以主进程实读为准。
 */
import { MEDIA_URL_PREFIX, mediaSourceKindOf, type MediaSourceKind } from '../media/source'
import { FILE_ROOT, normalizeRemotePath } from './path'

/** 预览种类：在媒体源种类之外补一个音频（音频不属于影视墙的媒体源分类） */
export type FilePreviewKind = MediaSourceKind | 'audio'

/** 音频扩展名：影视墙不认音频，预览单独识别（只列 Chromium 真能播的） */
const AUDIO_EXTENSIONS = ['mp3', 'flac', 'wav', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'weba']

/** 地址里标记「这是路径预览、不是媒体 ID」的固定段 */
export const FILE_PREVIEW_SEGMENT = 'path'

export interface FilePreviewTarget {
  connectionId: string
  /** 归一化之后的连接内路径 */
  path: string
}

/** 预览类型：先认音频，其余沿用媒体源分类（video / image / nfo / other） */
export function filePreviewKindOf(mime: string, extname: string): FilePreviewKind {
  if (AUDIO_EXTENSIONS.includes(extname.toLowerCase()) || mime.startsWith('audio/')) {
    return 'audio'
  }
  return mediaSourceKindOf(mime, extname)
}

/** 构造只读预览地址；`modifiedAt` 大于 0 时带上缓存击穿参数 */
export function buildFilePreviewUrl(connectionId: string, path: string, modifiedAt = 0): string {
  const url = `${MEDIA_URL_PREFIX}${connectionId}/${FILE_PREVIEW_SEGMENT}/${encodeURIComponent(path)}`
  return modifiedAt > 0 ? `${url}?v=${modifiedAt}` : url
}

/** 解析只读预览地址；不是路径预览（含越界路径）一律返回 null */
export function parseFilePreviewUrl(url: string): FilePreviewTarget | null {
  if (!url.startsWith(MEDIA_URL_PREFIX)) return null

  const parts = url
    .slice(MEDIA_URL_PREFIX.length)
    .split('?')[0]
    .split('#')[0]
    .split('/')
  if (parts.length < 3) return null

  const [connectionId, segment] = parts
  if (!connectionId || segment !== FILE_PREVIEW_SEGMENT) return null

  let path: string
  try {
    path = normalizeRemotePath(decodeURIComponent(parts.slice(2).join('/')))
  } catch {
    return null
  }
  if (path === FILE_ROOT) return null

  return { connectionId, path }
}
