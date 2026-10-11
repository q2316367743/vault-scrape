import type { FileEntry } from '@common/types/file'
import { mediaSourceKindOf, parseNfoXml } from '@common/types/media'
import { stripExtension } from '@common/types/scrape'
import { listItemCastNames } from '$/db/repo/actorRepo'
import { syncItemCast } from '$/modules/actor/actorLink'
import type { FileClient } from '$/modules/file/FileClient'

/**
 * 扫描期的 NFO 处理：判定「磁盘上有没有 NFO」的扫描证据，以及给未刮削的条目补参演名单。
 *
 * 契约：
 * - 只读 NFO、不写 NFO；名单解释一次就落 `media_cast`，之后查询都走数据库（NFO 只是提供方）；
 * - 已经有名单或已经刮削的条目不再读文件，重扫不会覆盖刮削结果；
 * - 读文件失败静默跳过：条目照常入库，名单等刮削补齐。
 */

/** 目录里所有 NFO 的基础名（小写）；`movie` 表示目录级 NFO */
export function collectNfoBases(files: readonly FileEntry[]): ReadonlySet<string> {
  const bases = new Set<string>()
  for (const file of files) {
    if (mediaSourceKindOf(file.mime, file.extname) !== 'nfo') continue
    bases.add(stripExtension(file.name).toLowerCase())
  }
  return bases
}

/** 同目录有 `movie.nfo`（目录级）或与视频同名的 `.nfo` 时算「磁盘上已有 NFO 产出」 */
export function hasNfoEvidence(file: FileEntry, nfoBases: ReadonlySet<string>): number {
  if (nfoBases.has('movie')) return 1
  return nfoBases.has(stripExtension(file.name).toLowerCase()) ? 1 : 0
}

/** 与视频配套的 NFO 文件：优先目录级 `movie.nfo`，其次与视频同名的 `.nfo` */
function nfoFileFor(video: FileEntry, files: readonly FileEntry[]): FileEntry | null {
  const base = stripExtension(video.name).toLowerCase()
  let matched: FileEntry | null = null
  for (const file of files) {
    if (file.type !== 'file') continue
    if (mediaSourceKindOf(file.mime, file.extname) !== 'nfo') continue
    const name = stripExtension(file.name).toLowerCase()
    if (name === 'movie') return file
    if (name === base) matched = file
  }
  return matched
}

/** 未刮削的影片：把同目录 NFO 里的 `<actor>` 读进 `media_cast`，并按名字建好演员档案 */
export async function backfillCastFromNfo(
  client: FileClient,
  itemId: string,
  files: readonly FileEntry[],
  video: FileEntry
): Promise<void> {
  const nfo = nfoFileFor(video, files)
  if (!nfo) return
  if (listItemCastNames(itemId).length > 0) return
  let names: readonly string[] = []
  try {
    const meta = parseNfoXml(await client.readText(nfo.path))
    names = meta?.actors ?? []
  } catch {
    return
  }
  if (names.length === 0) return
  syncItemCast(itemId, names)
}
