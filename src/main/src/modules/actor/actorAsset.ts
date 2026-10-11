import { nativeImage } from 'electron'
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, extname } from 'node:path'
import { ActorError } from '@common/types/actor'
import { ACTOR_IMAGE_MAX_BYTES, isActorImageExtension, buildActorImageUrl } from '@common/types/actor'
import type {
  ActorImageImportFailure,
  ActorImageImportRequest,
  ActorImageImportResult,
  ActorImageKind,
  ActorImageSource,
  ActorPhoto
} from '@common/types/actor'
import type { ActorImageRow } from '$/db/schema'
import {
  deleteActorImage,
  getActor,
  getActorImage,
  insertActorImage,
  listActorImages,
  updateActor
} from '$/db/repo/actorRepo'
import { actorImageDir, buildActorImagePath, isInsideActorRoot } from './actorPaths'

/**
 * 演员图片的落盘与落库。
 *
 * 契约：
 * - 图片一律复制进应用数据目录，**不引用用户原文件**（用户移动或删除原文件不影响演员资料）；
 * - 导入按文件粒度返回失败原因，一张图坏掉不影响其它图片；
 * - 删除只允许删应用数据目录内的文件，路径不在目录内时只删数据库行。
 */

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif'
}

/** 图片行 → 展示形状 */
export function actorPhotoOf(row: ActorImageRow): ActorPhoto {
  return {
    imageId: row.id,
    url: buildActorImageUrl(row.id, row.name),
    name: row.name,
    source: row.source
  }
}

export function listActorPhotos(actorId: string): ActorPhoto[] {
  return listActorImages(actorId)
    .filter((row) => row.kind !== 'avatar')
    .map(actorPhotoOf)
}

/** 演员当前的展示头像；没有头像或文件已丢失时返回 null */
export function actorAvatarOf(actorId: string, avatarImageId: string): ActorPhoto | null {
  if (!avatarImageId) return null
  const row = getActorImage(avatarImageId)
  if (!row || row.actorId !== actorId || !existsSync(row.path)) return null
  return actorPhotoOf(row)
}

function actorImageRow(imageId: string): ActorImageRow {
  const row = getActorImage(imageId)
  if (!row) throw new ActorError('notFound', '图片不存在或已被删除')
  return row
}

export interface SaveActorImageInput {
  actorId: string
  /** 源文件绝对路径（用户选中的图片，或抓取下载的临时文件） */
  sourcePath: string
  kind: ActorImageKind
  source: ActorImageSource
  /** 展示名；不给则取源文件名 */
  name?: string
  /**
   * 扩展名提示（可带点）：抓取下载的临时文件没有扩展名、展示名也不带扩展名时用，
   * 例如从资源 url 末段取到的 `jpg`。
   */
  extension?: string
}

/**
 * 扩展名：显式提示优先，其次源文件；抓取下载的临时文件没有扩展名时改用展示名推断。
 */
function readExtension(input: SaveActorImageInput): string {
  const explicit = (input.extension ?? '').toLowerCase().replace(/^\./, '')
  if (isActorImageExtension(explicit)) return explicit
  const fromSource = extname(input.sourcePath).toLowerCase().replace(/^\./, '')
  if (isActorImageExtension(fromSource)) return fromSource
  return extname(input.name ?? '').toLowerCase().replace(/^\./, '')
}

/**
 * 把一个本机文件收进演员图片目录并落库。
 *
 * 头像只保留一张：`kind === 'avatar'` 且演员还没有头像时自动设为头像，
 * 已存在头像时按图集保存，避免抓取多次覆盖用户手动选的头像。
 */
export function saveActorImage(input: SaveActorImageInput): ActorImageRow {
  const actor = getActor(input.actorId)
  if (!actor) throw new ActorError('notFound')

  const extension = readExtension(input)
  if (!isActorImageExtension(extension)) {
    throw new ActorError('invalidArgument', `不支持的图片格式：${extension || '未知'}`)
  }

  const imageId = randomUUID()
  const target = buildActorImagePath(input.actorId, imageId, extension)
  mkdirSync(actorImageDir(input.actorId), { recursive: true })
  copyFileSync(input.sourcePath, target)

  const size = statSync(target).size
  const dimension = nativeImage.createFromPath(target).getSize()
  const name = input.name?.trim() || basename(input.sourcePath)
  const becomesAvatar = input.kind === 'avatar' && !actor.avatarImageId
  const rowKind: ActorImageKind = becomesAvatar ? 'avatar' : input.kind === 'avatar' ? 'photo' : input.kind
  insertActorImage({
    id: imageId,
    actorId: input.actorId,
    kind: rowKind,
    path: target,
    name,
    extname: extension,
    mime: MIME_BY_EXTENSION[extension] ?? 'application/octet-stream',
    size,
    width: dimension.width,
    height: dimension.height,
    source: input.source
  })
  if (becomesAvatar) updateActor(input.actorId, { avatarImageId: imageId })

  const row = getActorImage(imageId)
  if (!row) throw new ActorError('ioFailed', '图片已复制但写入数据库失败')
  return row
}

/** 批量导入用户选中的图片；单张失败不影响其它图片 */
export function importActorImages(input: ActorImageImportRequest): ActorImageImportResult {
  const images: ActorImageImportResult['images'] = []
  const failed: ActorImageImportFailure[] = []

  for (const path of input.paths) {
    const reason = describeImportFailure(path)
    if (reason) {
      failed.push({ path, reason })
      continue
    }
    try {
      const row = saveActorImage({
        actorId: input.actorId,
        sourcePath: path,
        kind: input.kind,
        source: 'user',
        name: basename(path)
      })
      images.push({ imageId: row.id, url: buildActorImageUrl(row.id, row.name) })
    } catch (error) {
      failed.push({ path, reason: error instanceof Error ? error.message : '导入失败' })
    }
  }

  return { images, failed }
}

/** 导入前的文件级校验；返回空串表示可以导入 */
function describeImportFailure(path: string): string {
  if (!path.trim()) return '路径为空'
  if (!existsSync(path)) return '文件不存在'
  const stats = statSync(path)
  if (!stats.isFile()) return '不是文件'
  if (!isActorImageExtension(extname(path))) return '不是支持的图片格式'
  if (stats.size > ACTOR_IMAGE_MAX_BYTES) return '图片超过 20MB'
  return ''
}

/** 删除一张图片：先删数据库行，再删应用数据目录内的文件 */
export function removeActorImage(actorId: string, imageId: string): boolean {
  const row = actorImageRow(imageId)
  if (row.actorId !== actorId) throw new ActorError('notFound', '这张图片不属于该演员')
  const removed = deleteActorImage(actorId, imageId)
  if (removed) removeFile(row.path)
  return removed
}

/** 删除演员时清掉它的所有图片文件 */
export function removeActorImageFiles(rows: readonly ActorImageRow[]): void {
  for (const row of rows) removeFile(row.path)
}

/** 只删我们自己目录里的文件：库里存的是绝对路径，越界路径一律不动 */
function removeFile(path: string): void {
  if (!isInsideActorRoot(path)) return
  try {
    rmSync(path, { force: true })
  } catch {
    // 文件删不掉不是错误：数据库行已经清了，残留文件不影响功能
  }
}
