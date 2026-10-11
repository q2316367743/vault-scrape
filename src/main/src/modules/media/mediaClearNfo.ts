/**
 * 「清除 NFO」：把一部影片的刮削成果清干净，退回「扫描过、还没刮」的状态。
 *
 * 契约：
 * - 先删磁盘上的 NFO（同目录 `movie.nfo` 与 `<视频基础名>.nfo`，存在的都删），再清库内数据；
 *   磁盘这一步失败就整体失败、库内数据原样保留 —— 只清库不删盘，下次开「优先本地 NFO」重刮
 *   会把同一份错误数据再读回来；
 * - 库内清空：条目刮削列归零、展示名与番号还原成扫描期取值，该条目的图片记录
 *   （`media_image`）与参演名单（`media_cast`）一起删；
 * - 磁盘上的视频与图片文件一律保留，演员本人档案（`actor`）不动；
 * - 只对影片条目生效：条目不存在、不是影片、没有媒体源都抛 `MediaError`。
 */
import { basenameRemotePath, dirnameRemotePath, joinRemotePath } from '@common/types/file'
import { MediaError, type MediaClearNfoRequest, type MediaClearNfoResult } from '@common/types/media'
import { extractKeyword, normalizeNum } from '@common/types/scrape'
import { deleteCastByItems } from '$/db/repo/actorRepo'
import { deleteImagesByItem } from '$/db/repo/mediaImageRepo'
import { clearItemMetadata, getItem, listSourcesByItem } from '$/db/repo/mediaRepo'
import { getFileClient } from '$/modules/file/fileClientManager'
import { nfoCandidates, primarySourceOf } from '$/modules/media/mediaWall'

/** 删掉同目录里存在的 NFO，返回真的删掉的那些路径；删不掉直接抛 `writeFailed` */
async function removeNfoFiles(
  connectionId: string,
  dirPath: string,
  names: readonly string[]
): Promise<string[]> {
  const removed: string[] = []
  try {
    const client = await getFileClient(connectionId)
    for (const name of names) {
      const target = joinRemotePath(dirPath, name)
      if (!(await client.exists(target))) continue
      await client.remove(target)
      removed.push(target)
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new MediaError('writeFailed', `磁盘上的 NFO 没有删除（${reason}），刮削数据保持不变`)
  }
  return removed
}

/**
 * 清除一部影片的 NFO 与刮削数据。
 *
 * 步骤固定为「先磁盘、后数据库」：磁盘删失败时库里一切照旧，不会出现「数据清了、NFO 还在」
 * 的半成品状态；数据库部分只有本地写，失败概率极低。
 */
export async function clearMediaNfo(request: MediaClearNfoRequest): Promise<MediaClearNfoResult> {
  const itemId = request.itemId.trim()
  if (itemId.length === 0) throw new MediaError('invalidArgument', '缺少影片 ID')
  const item = getItem(itemId)
  if (!item || item.type !== 'movie') throw new MediaError('notFound', '索引里没有这部影片')
  const source = primarySourceOf(item, listSourcesByItem(itemId))
  if (!source) throw new MediaError('notFound', '这部影片没有可用的媒体源')

  const removedNfo = await removeNfoFiles(
    source.connectionId,
    dirnameRemotePath(source.path),
    nfoCandidates(source)
  )

  // 还原口径与扫描一致：展示名 = 磁盘上的视频文件名（含扩展名），番号从该文件名解析
  const fileName = basenameRemotePath(source.path)
  clearItemMetadata(itemId, { name: fileName, num: normalizeNum(extractKeyword(fileName).num) })
  deleteImagesByItem(itemId)
  deleteCastByItems([itemId])

  return { itemId, removedNfo }
}
