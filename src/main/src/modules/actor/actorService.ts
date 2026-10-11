/**
 * 演员模块的读模型：列表页与详情页的数据装配。
 *
 * 契约：
 * - 只读，不落盘、不改库；
 * - 分页与筛选都在数据库侧完成（`offset` / `limit`），返回过滤后的 `total`；
 * - 详情页的「出演作品」复用影视墙的条目装配（`loadWallItems`），排版与影视墙一致。
 */
import {
  ActorError,
  type ActorDetailRequest,
  type ActorDetailResult,
  type ActorListRequest,
  type ActorListResult
} from '@common/types/actor'
import {
  countActors,
  getActor,
  listActors,
  listAllTags,
  listItemIdsByActorNameKey
} from '$/db/repo/actorRepo'
import { loadWallItems } from '$/modules/media/mediaWall'
import { actorDetailOf, actorSummaryOf } from './actorView'

/** 每页条数上限：渲染层传超也在这里夹住，避免一次拉全库 */
export const ACTOR_LIST_MAX_LIMIT = 200

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 60
  return Math.min(Math.max(Math.floor(limit), 1), ACTOR_LIST_MAX_LIMIT)
}

export function loadActorList(request: ActorListRequest): ActorListResult {
  const keyword = request.keyword.trim()
  const tag = request.tag.trim()
  const limit = clampLimit(request.limit)
  const offset = Number.isFinite(request.offset) ? Math.max(0, Math.floor(request.offset)) : 0
  const entries = listActors({ keyword, tag, sort: request.sort, offset, limit })
  return {
    items: entries.map(actorSummaryOf),
    total: countActors(keyword, tag),
    tags: listAllTags()
  }
}

export function loadActorDetail(request: ActorDetailRequest): ActorDetailResult {
  const actorId = request.actorId.trim()
  const actor = actorId.length > 0 ? getActor(actorId) : null
  if (!actor) throw new ActorError('notFound')
  const films = loadWallItems(listItemIdsByActorNameKey(actor.nameKey)).sort(
    (left, right) => right.dateAdded - left.dateAdded
  )
  return { actor: actorDetailOf(actor), films }
}
