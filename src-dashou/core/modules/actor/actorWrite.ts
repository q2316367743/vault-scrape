/**
 * 演员模块的写操作：保存用户设定数据、删除演员、改头像。
 *
 * 契约：
 * - 姓名是身份键（`name_key`），同一份归一化键只能有一个演员，撞了就抛 `conflict`；
 * - 别名走 `replaceAliases`（先删后插），永远以渲染层提交的列表为准；
 * - 删除演员时连带清掉图集文件（文件删除失败不影响数据库结果）。
 */
import { randomUUID } from 'node:crypto'
import {
  ActorError,
  actorNameKey,
  actorUniqueNames,
  type ActorImageRequest,
  type ActorRemoveRequest,
  type ActorSaveRequest,
  type ActorSaveResult
} from '@common/types/actor'
import {
  deleteActor,
  ensureActorByName,
  findActorByName,
  getActor,
  getActorImage,
  replaceAliases,
  setActorAvatar,
  updateActor,
  type ActorProfilePatch
} from '$/db/repo/actorRepo'
import { removeActorImageFiles } from './actorAsset'

/** 用户标签去重（保序、丢空串） */
function cleanTags(tags: readonly string[]): string[] {
  const result: string[] = []
  for (const tag of tags) {
    const value = tag.trim()
    if (value.length === 0 || result.includes(value)) continue
    result.push(value)
  }
  return result
}

function count(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

/** 姓名必填（归一化后为空说明全是空白字符） */
function readName(request: ActorSaveRequest): string {
  const name = request.name.trim()
  if (name.length === 0 || actorNameKey(name).length === 0) {
    throw new ActorError('invalidArgument', '演员姓名不能为空')
  }
  return name
}

/** 同一份归一化姓名只能有一个演员，`selfId` 是「改自己」时允许命中的那条 */
function assertNameFree(name: string, selfId: string): void {
  const existing = findActorByName(name)
  if (existing && existing.id !== selfId) throw new ActorError('conflict')
}

/** 用户设定数据的公共部分（姓名单独传，因为新增 / 更新两条路径的落点不同） */
function profileOf(request: ActorSaveRequest): ActorProfilePatch {
  return {
    gender: request.gender,
    birthday: request.birthday.trim(),
    birthCountry: request.birthCountry.trim(),
    birthProvince: request.birthProvince.trim(),
    birthCity: request.birthCity.trim(),
    birthCounty: request.birthCounty.trim(),
    height: count(request.height),
    bust: count(request.bust),
    waist: count(request.waist),
    hip: count(request.hip),
    cup: request.cup.trim(),
    tagline: request.tagline.trim(),
    sourceUrl: request.sourceUrl.trim(),
    overview: request.overview,
    tags: cleanTags(request.tags),
    locked: request.locked
  }
}

/** 保存演员：`actorId` 为空是新增，否则是更新（两者都会整体覆盖别名列表） */
export function saveActor(request: ActorSaveRequest): ActorSaveResult {
  const name = readName(request)
  const actorId = request.actorId.trim()
  if (actorId.length === 0) {
    assertNameFree(name, '')
    const id = randomUUID()
    const row = ensureActorByName({ id, name, ...profileOf(request) })
    if (row.id !== id) throw new ActorError('conflict')
    replaceAliases(id, actorUniqueNames(request.aliases))
    return { actorId: id }
  }

  const actor = getActor(actorId)
  if (!actor) throw new ActorError('notFound')
  assertNameFree(name, actor.id)
  if (!updateActor(actor.id, { name, ...profileOf(request) })) throw new ActorError('notFound')
  replaceAliases(actor.id, actorUniqueNames(request.aliases))
  return { actorId: actor.id }
}

/** 删除演员：先删库（拿到图片行），再清数据目录里的图集文件 */
export function removeActor(request: ActorRemoveRequest): void {
  const actor = getActor(request.actorId.trim())
  if (!actor) throw new ActorError('notFound')
  removeActorImageFiles(deleteActor(actor.id))
}

/** 把某张已有的图片设为头像（图片必须属于该演员） */
export function setActorAvatarOf(request: ActorImageRequest): void {
  const actorId = request.actorId.trim()
  const image = getActorImage(request.imageId.trim())
  if (!image || image.actorId !== actorId) {
    throw new ActorError('notFound', '这张图片不属于该演员')
  }
  if (!setActorAvatar(actorId, image.id)) throw new ActorError('notFound')
}
