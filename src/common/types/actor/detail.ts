/**
 * 演员资料的只读展示形状与字段拼装纯函数。
 *
 * 契约：
 * - `ActorSummary` 用于列表页与影片详情页的演员条，字段够画头像 + 名字 + 作品数；
 * - `ActorDetail` 是演员详情页的完整形状，图片地址一律是 `storage://actor/...`；
 * - 出生地与三围的文案在渲染前由纯函数拼好，两个页面共用同一套写法。
 */
import type { ActorGender } from './gender'
import type { ActorImageSource } from './image'

/** 演员图片（头像与图集共用一种形状） */
export interface ActorPhoto {
  imageId: string
  /** `storage://actor/{imageId}/{文件名}` */
  url: string
  /** 原始文件名，用于展示与提示 */
  name: string
  source: ActorImageSource
}

/** 列表页 / 影片详情页用的一行演员 */
export interface ActorSummary {
  actorId: string
  name: string
  gender: ActorGender
  /** 头像地址；没有头像为空串 */
  avatarUrl: string
  /** 用户标签 */
  tags: string[]
  /** 出演作品数 */
  filmCount: number
}

/** 演员详情页的完整形状 */
export interface ActorDetail {
  actorId: string
  name: string
  aliases: string[]
  gender: ActorGender
  /** `YYYY-MM-DD`；未设置为空串 */
  birthday: string
  birthCountry: string
  birthProvince: string
  birthCity: string
  birthCounty: string
  /** 身高（cm）；0 表示未设置 */
  height: number
  /** 三围（cm）；0 表示未设置 */
  bust: number
  waist: number
  hip: number
  /** 罩杯；未设置为空串 */
  cup: string
  tagline: string
  sourceUrl: string
  overview: string
  /** 用户标签（刮削不会写入这一项） */
  tags: string[]
  /** 锁定后刮削只填空白字段 */
  locked: boolean
  /** 上次抓取时间；0 表示从未抓取 */
  scrapedAt: number
  /** 上次命中的插件 ID；未命中为空串 */
  scraperId: string
  avatarUrl: string
  /** 图集（不含头像本身） */
  photos: ActorPhoto[]
}

/** 出生地文案；国家 / 省 / 市 / 县逐级拼接，全空时返回空串 */
export function actorBirthplaceText(actor: {
  birthCountry: string
  birthProvince: string
  birthCity: string
  birthCounty: string
}): string {
  return [actor.birthCountry, actor.birthProvince, actor.birthCity, actor.birthCounty]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(' · ')
}

/** 三围文案：`88-60-88 cm`；没填任何一项返回空串 */
export function actorMeasurementsText(actor: {
  bust: number
  waist: number
  hip: number
}): string {
  const parts = [actor.bust, actor.waist, actor.hip].map((value) => (value > 0 ? `${value}` : '–'))
  if (!actor.bust && !actor.waist && !actor.hip) return ''
  return `${parts.join('-')} cm`
}

/** 身高文案：`165 cm`；未设置返回空串 */
export function actorHeightText(height: number): string {
  return height > 0 ? `${height} cm` : ''
}
