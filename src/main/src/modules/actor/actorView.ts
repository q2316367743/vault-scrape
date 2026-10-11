import type { ActorDetail, ActorSummary } from '@common/types/actor'
import type { ActorRow } from '$/db/schema'
import { actorTagsOf, listAliases } from '$/db/repo/actorRepo'
import type { ActorListEntry } from '$/db/repo/actorRepo'
import { actorAvatarOf, listActorPhotos } from './actorAsset'

/**
 * 数据库行 → 公共展示形状。
 *
 * 契约：
 * - 头像与图集地址在这里统一拼成 `storage://actor/...`，渲染层不接触磁盘路径；
 * - 头像文件丢失时 `avatarUrl` 回落空串，页面自己显示占位，不报错。
 */

export function actorSummaryOf(entry: ActorListEntry): ActorSummary {
  const { actor } = entry
  return {
    actorId: actor.id,
    name: actor.name,
    gender: actor.gender,
    avatarUrl: actorAvatarOf(actor.id, actor.avatarImageId)?.url ?? '',
    tags: actorTagsOf(actor),
    filmCount: entry.filmCount
  }
}

export function actorDetailOf(actor: ActorRow): ActorDetail {
  return {
    actorId: actor.id,
    name: actor.name,
    aliases: listAliases(actor.id).map((row) => row.alias),
    gender: actor.gender,
    birthday: actor.birthday,
    birthCountry: actor.birthCountry,
    birthProvince: actor.birthProvince,
    birthCity: actor.birthCity,
    birthCounty: actor.birthCounty,
    height: actor.height,
    bust: actor.bust,
    waist: actor.waist,
    hip: actor.hip,
    cup: actor.cup,
    tagline: actor.tagline,
    sourceUrl: actor.sourceUrl,
    overview: actor.overview,
    tags: actorTagsOf(actor),
    locked: actor.locked,
    scrapedAt: actor.scrapedAt,
    scraperId: actor.scraperId,
    avatarUrl: actorAvatarOf(actor.id, actor.avatarImageId)?.url ?? '',
    photos: listActorPhotos(actor.id)
  }
}
