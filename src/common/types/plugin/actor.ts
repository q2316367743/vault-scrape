/**
 * 演员抓取的插件契约（可选能力）。
 *
 * 契约：
 * - 插件可以只实现四个必需方法；额外实现 `actor` / `actorAssets` 后，宿主在影片刮削入库时
 *   就能按演员姓名补全资料与图片（见 main 的 `modules/actor/actorScrape`）；
 * - 与 `detail` / `covers` 的分工保持一致：`actor` 只返回元数据，`actorAssets` 只返回资源地址；
 * - 头像约定用 `poster`，图集用 `thumb` / `still`，其余 kind 在归一化阶段丢弃；
 * - 插件返回的字段一律可选，宿主只填空、不覆盖用户锁定或手填的资料。
 */
import type { ActorGender } from '../actor'
import type { PluginAssetKind } from './asset'

export interface PluginActorDetail {
  /** 演员姓名（必填，同时是宿主的匹配键） */
  name: string
  aliases?: string[]
  gender?: ActorGender
  /** 出生日期，`YYYY-MM-DD` */
  birthday?: string
  birthCountry?: string
  birthProvince?: string
  birthCity?: string
  birthCounty?: string
  /** 厘米；缺失或 0 表示未提供 */
  height?: number
  bust?: number
  waist?: number
  hip?: number
  cup?: string
  tagline?: string
  sourceUrl?: string
  overview?: string
  tags?: string[]
}

/** 演员钩子允许的资源类型：头像用 poster，图集用 thumb / still */
export const PLUGIN_ACTOR_ASSET_KINDS: readonly PluginAssetKind[] = ['poster', 'thumb', 'still']
