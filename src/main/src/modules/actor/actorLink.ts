import { randomUUID } from 'node:crypto'
import { actorNameKey, actorUniqueNames } from '@common/types/actor'
import type { MediaActorRef } from '@common/types/media'
import {
  ensureActorByName,
  findActorByAlias,
  findActorByName,
  listActorsByNames,
  listItemCastNames,
  replaceItemCast
} from '$/db/repo/actorRepo'
import { actorAvatarOf } from './actorAsset'

/**
 * 影视 ↔ 演员的**弱关联**（按名字，见 `media_cast`）。
 *
 * 契约：
 * - 关联表只存姓名与姓名键：影视→演员按 `ordinal` 取名字，演员→影视按 `name_key` 匹配；
 * - 名字同时是演员档案的身份键：匹配不到时按名字建一条「只有姓名」的演员（先姓名后别名匹配，
 *   尽量把同一演员的不同写法归到一行）；
 * - 只写数据库，不发任何网络请求 —— 资料与图片由 actorScrape 负责；
 * - 刮削 / 扫描每部影片都整组替换该影片的名单，顺序沿用 NFO 或插件给出的出演顺序。
 */

export interface ActorCastResult {
  /** 写进关联表的名单（已去重，保持出演顺序） */
  names: string[]
  /** 本次新建的演员 ID（用于提示「新增了几位演员」） */
  createdIds: string[]
}

/** 姓名 → 演员 ID：已有演员按姓名或别名命中，否则新建 */
export function resolveActorId(name: string, createdIds: string[]): string {
  const normalized = actorNameKey(name)
  if (!normalized) return ''

  const byName = findActorByName(name)
  if (byName) return byName.id

  const byAlias = findActorByAlias(name)
  if (byAlias) return byAlias.id

  const created = ensureActorByName({ id: randomUUID(), name: name.trim() })
  createdIds.push(created.id)
  return created.id
}

/** 只为名单里的名字建/找演员档案，不写关联（扫描补全 NFO 名单时用） */
export function ensureActorsOf(names: readonly string[]): string[] {
  const createdIds: string[] = []
  for (const name of actorUniqueNames(names)) resolveActorId(name, createdIds)
  return createdIds
}

/** 把一串姓名写到某部影片上（扫描读 NFO 与刮削写结果共用） */
export function syncItemCast(itemId: string, names: readonly string[]): ActorCastResult {
  const unique = actorUniqueNames(names)
  const createdIds: string[] = []
  for (const name of unique) resolveActorId(name, createdIds)
  replaceItemCast(itemId, unique)
  return { names: unique, createdIds }
}

/** 某部影片的参演演员（影片详情页的演员条用）：名字 → 库里演员行 → 头像 */
export function actorRefsOfItem(itemId: string): MediaActorRef[] {
  const names = listItemCastNames(itemId)
  if (names.length === 0) return []
  const byKey = new Map(listActorsByNames(names).map((row) => [row.nameKey, row]))
  return names.map((name) => {
    const row = byKey.get(actorNameKey(name))
    if (!row) return { actorId: '', name, avatarUrl: '' }
    return {
      actorId: row.id,
      name: row.name,
      avatarUrl: actorAvatarOf(row.id, row.avatarImageId)?.url ?? ''
    }
  })
}
