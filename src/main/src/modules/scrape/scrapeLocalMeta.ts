/**
 * 本地优先：从影片目录读本地 NFO 与本地图片。
 *
 * 契约：
 * - 只读，不改任何文件；失败一律当作「本地没有」，绝不影响后续联网刮削；
 * - NFO 候选顺序：`<原名>.nfo` → `movie.nfo`；解析失败（无 `<movie>` 根或全空）视为没有；
 * - 图片按 Jellyfin 常见名识别：主图（poster / cover / folder / 与影片同名）、
 *   背景图（backdrop / background / fanartN）、缩略图（thumbN）、横幅（banner）、
 *   徽标（logo / clearlogo）；剧照取剧照子目录（`fanartDirName`）下的全部图片；
 * - `assetNaming === 'movie'` 的 `<影片名>-poster.jpg` 这类前缀名同样识别；
 * - 读到的本地 NFO 会合成为 `PluginMovieDetail`（`id` 为空，因为 NFO 里没有插件条目 ID）。
 */
import { extnameOf, joinRemotePath } from '@common/types/file'
import type { MediaNfoMeta } from '@common/types/media'
import { parseNfoXml } from '@common/types/media'
import type { PluginAssetKind, PluginMovieDetail } from '@common/types/plugin'
import type { FileClient } from '$/modules/file/FileClient'

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp',
  'avif'
])

const FIXED_IMAGE_KINDS: Readonly<Record<string, PluginAssetKind>> = {
  poster: 'poster',
  cover: 'poster',
  folder: 'poster',
  backdrop: 'fanart',
  background: 'fanart',
  thumb: 'thumb',
  banner: 'banner',
  logo: 'logo',
  clearlogo: 'logo'
}

const FANART_NAME_PATTERN = /^fanarts?\d*$/
const THUMB_NAME_PATTERN = /^thumbs?\d*$/
const STILL_NAME_PATTERN = /^(?:still|screenshot)s?\d*$/

/** 本地读到的一张图片 */
export interface LocalImage {
  kind: PluginAssetKind
  /** 原始文件名（含扩展名） */
  name: string
  /** 连接内绝对路径 */
  path: string
}

/** 本地 NFO */
export interface LocalNfo {
  name: string
  path: string
  meta: MediaNfoMeta
}

export interface LocalMeta {
  nfo: LocalNfo | null
  /** 本地 NFO 合成的详情；没有本地 NFO 时为 null */
  detail: PluginMovieDetail | null
  /** 按 kind 归类的本地图片（同 kind 内按文件名排序） */
  assets: Map<PluginAssetKind, LocalImage[]>
}

/** 去掉扩展名（保留点号开头之外的全部内容） */
function stemOf(name: string): string {
  const ext = extnameOf(name)
  return ext.length === 0 ? name : name.slice(0, -(ext.length + 1))
}

/**
 * 按文件名判断图片属于哪种资源；识别不出返回 null。
 *
 * `originalBase` 是扫描到的原视频基础名，用来识别「与影片同名的主图」与 `<影片名>-` 前缀命名。
 */
export function imageKindOfName(name: string, originalBase: string): PluginAssetKind | null {
  const ext = extnameOf(name)
  if (!IMAGE_EXTENSIONS.has(ext)) return null
  const stem = stemOf(name).toLowerCase()
  if (stem.length === 0) return null
  const original = originalBase.trim().toLowerCase()
  if (original.length > 0 && stem === original) return 'poster'
  const bare =
    original.length > 0 && stem.startsWith(`${original}-`)
      ? stem.slice(original.length + 1)
      : stem
  if (STILL_NAME_PATTERN.test(bare)) return 'still'
  if (FANART_NAME_PATTERN.test(bare)) return 'fanart'
  if (THUMB_NAME_PATTERN.test(bare)) return 'thumb'
  return FIXED_IMAGE_KINDS[bare] ?? null
}

/** 列目录：失败（不存在 / 无权限）一律当作空目录 */
async function listQuietly(client: FileClient, dirPath: string): Promise<string[]> {
  try {
    const entries = await client.list(dirPath)
    return entries.filter((entry) => entry.type === 'file').map((entry) => entry.name)
  } catch {
    return []
  }
}

/** 读本地 NFO：`<原名>.nfo` → `movie.nfo` */
export async function readLocalNfo(
  client: FileClient,
  dirPath: string,
  originalBase: string
): Promise<LocalNfo | null> {
  const candidates: string[] = []
  for (const name of [`${originalBase}.nfo`, 'movie.nfo']) {
    if (name.length > 0 && !candidates.includes(name)) candidates.push(name)
  }
  for (const name of candidates) {
    const path = joinRemotePath(dirPath, name)
    try {
      if (!(await client.exists(path))) continue
      const meta = parseNfoXml(await client.readText(path))
      if (meta) return { name, path, meta }
    } catch {
      // 单个候选读失败就继续；本地 NFO 只是加速手段
    }
  }
  return null
}

/** 读本地图片：影片目录按固定名识别，剧照目录下全部图片都算剧照 */
export async function readLocalImages(
  client: FileClient,
  dirPath: string,
  originalBase: string,
  fanartDirName: string
): Promise<Map<PluginAssetKind, LocalImage[]>> {
  const assets = new Map<PluginAssetKind, LocalImage[]>()
  const push = (kind: PluginAssetKind, name: string, path: string): void => {
    const bucket = assets.get(kind) ?? []
    bucket.push({ kind, name, path })
    assets.set(kind, bucket)
  }

  const names = (await listQuietly(client, dirPath)).sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true })
  )
  for (const name of names) {
    const kind = imageKindOfName(name, originalBase)
    if (!kind) continue
    push(kind, name, joinRemotePath(dirPath, name))
  }

  const folderName = fanartDirName.trim() || 'extrafanart'
  const stillNames = (await listQuietly(client, joinRemotePath(dirPath, folderName))).sort(
    (left, right) => left.localeCompare(right, undefined, { numeric: true })
  )
  for (const name of stillNames) {
    if (!IMAGE_EXTENSIONS.has(extnameOf(name))) continue
    push('still', name, joinRemotePath(joinRemotePath(dirPath, folderName), name))
  }

  return assets
}

/** 读本地 NFO 与本地图片（`localFirst` 的入口） */
export async function readLocalMeta(
  client: FileClient,
  options: { dirPath: string; originalBase: string; fanartDirName: string }
): Promise<LocalMeta> {
  const nfo = await readLocalNfo(client, options.dirPath, options.originalBase)
  const assets = await readLocalImages(
    client,
    options.dirPath,
    options.originalBase,
    options.fanartDirName
  )
  return { nfo, detail: nfo ? detailOfNfo(nfo.meta) : null, assets }
}

/** 本地 NFO → 插件详情形状（`id` 为空，NFO 里没有插件条目 ID） */
export function detailOfNfo(meta: MediaNfoMeta): PluginMovieDetail {
  return {
    id: '',
    title: meta.title,
    num: meta.num,
    originalTitle: meta.originalTitle,
    plot: meta.plot,
    actors: meta.actors,
    maker: meta.maker,
    label: meta.label,
    studio: meta.studio,
    series: meta.series,
    director: meta.director,
    releaseDate: meta.releaseDate,
    duration: meta.duration,
    tags: meta.tags
  }
}

/** 本地 NFO 的关键信息是否缺失（缺就仍然联网补） */
export function needsRemoteInfo(meta: MediaNfoMeta): boolean {
  if (meta.plot.trim().length === 0) return true
  if (meta.actors.length === 0) return true
  const credits = [meta.maker, meta.studio, meta.label, meta.series].join('').trim()
  return credits.length === 0
}

/** 取本地非空值，本地为空时回落联网结果 */
function prefer(localValue: string | undefined, remoteValue: string | undefined): string | undefined {
  const local = (localValue ?? '').trim()
  return local.length > 0 ? localValue : remoteValue
}

/**
 * 合并本地与联网详情：**本地优先**，本地缺失的字段才用联网结果补。
 *
 * `id` / `providerId` 一定取联网结果——本地 NFO 里没有这两个东西，而写回媒体库要用它们。
 */
export function mergeDetail(
  local: PluginMovieDetail,
  remote: PluginMovieDetail | null
): PluginMovieDetail {
  if (!remote) return local
  return {
    id: remote.id,
    providerId: remote.providerId,
    title: prefer(local.title, remote.title) ?? '',
    num: prefer(local.num, remote.num),
    originalTitle: prefer(local.originalTitle, remote.originalTitle),
    plot: prefer(local.plot, remote.plot),
    maker: prefer(local.maker, remote.maker),
    label: prefer(local.label, remote.label),
    studio: prefer(local.studio, remote.studio),
    series: prefer(local.series, remote.series),
    director: prefer(local.director, remote.director),
    releaseDate: prefer(local.releaseDate, remote.releaseDate),
    duration:
      typeof local.duration === 'number' && local.duration > 0 ? local.duration : remote.duration,
    actors: local.actors && local.actors.length > 0 ? local.actors : remote.actors,
    tags: local.tags && local.tags.length > 0 ? local.tags : remote.tags,
    episodes: remote.episodes
  }
}
