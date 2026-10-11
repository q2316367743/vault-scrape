/**
 * 演员图片的 `storage://` 分支。
 *
 * 契约：
 * - 地址形如 `storage://actor/{图片ID}/{文件名}`，**只认 `actor_image.id`**，
 *   文件名只参与展示；渲染层构造不出越权地址；
 * - 数据库里的路径只由 `actorAsset.saveActorImage` 写入，这里仍复核一次「文件落在
 *   演员图片根目录内」，防止手工改库造成越权读；
 * - 图片按 ID 定位、内容不可变，因此可以放心长缓存；失败一律 404，由调用方记日志。
 */
import { existsSync } from 'fs'
import { pathToFileURL } from 'url'
import { net } from 'electron'
import { guessMimeType } from '@common/types/file'
import { MEDIA_ID_PATTERN } from '@common/types/media'
import { getActorImage } from '$/db/repo/actorRepo'
import { isInsideActorRoot } from './actorPaths'

function notFound(): Response {
  return new Response(null, { status: 404 })
}

/** 把演员图片 ID 换成真实图片内容；不存在、越界、文件丢失都是 404 */
export async function serveActorImage(imageId: string): Promise<Response> {
  if (!MEDIA_ID_PATTERN.test(imageId)) return notFound()
  const row = getActorImage(imageId)
  if (!row || row.path.length === 0) return notFound()
  if (!isInsideActorRoot(row.path) || !existsSync(row.path)) return notFound()
  const response = await net.fetch(pathToFileURL(row.path).toString())
  const headers = new Headers(response.headers)
  headers.set('Content-Type', row.mime.length > 0 ? row.mime : guessMimeType(row.name))
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  return new Response(response.body, { status: response.status, headers })
}
