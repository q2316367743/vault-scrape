/**
 * 演员图片的公共契约：用途、允许的格式、体积上限与本机媒体地址。
 *
 * 契约：
 * - 图片文件落在应用数据目录（默认 `<插件数据目录>/media/actor`），数据库只存元信息；
 * - 渲染层拿到的地址是 本机媒体地址（演员图片），路径不出 core；
 * - 地址构造只走本文件的纯函数，渲染层不拼字符串。
 */
import { buildMediaUrl } from '../media/source'

/** 演员图片用途：头像最多一张，图集是其余全部 */
export type ActorImageKind = 'avatar' | 'photo'

export const ACTOR_IMAGE_KINDS: readonly ActorImageKind[] = ['avatar', 'photo']

export const ACTOR_IMAGE_KIND_LABELS: Readonly<Record<ActorImageKind, string>> = {
  avatar: '头像',
  photo: '图集'
}

/** 图片来源：用户导入 / 刮削下载；删除与覆盖时按它区分 */
export type ActorImageSource = 'user' | 'scrape'

/** 允许导入的图片扩展名（不带点） */
export const ACTOR_IMAGE_EXTENSIONS: readonly string[] = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp',
  'avif'
]

/** 单个图片文件体积上限：20MB */
export const ACTOR_IMAGE_MAX_BYTES = 20 * 1024 * 1024

/** 媒体地址里代表「演员图片」的固定段（与存储 ID 不会撞：存储 ID 是 UUID） */
export const ACTOR_MEDIA_SEGMENT = 'actor'

/** 演员图片地址；文件名只参与展示与扩展名推断，定位靠图片 ID */
export function buildActorImageUrl(imageId: string, fileName: string): string {
  return buildMediaUrl(ACTOR_MEDIA_SEGMENT, imageId, fileName)
}

/** 扩展名是否允许作为演员图片 */
export function isActorImageExtension(extname: string): boolean {
  return ACTOR_IMAGE_EXTENSIONS.includes(extname.toLowerCase().replace(/^\./, ''))
}
