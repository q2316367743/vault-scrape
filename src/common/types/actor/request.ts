/**
 * 演员模块的请求 / 返回形状。
 *
 * 契约：
 * - 全部字段都是渲染层可以安全持有的事实，图片只出现 `storage://actor/...` 地址；
 * - 列表分页在数据库侧完成（`offset` / `limit`），返回 `total` 供分页器使用；
 * - 抓取请求只带「用哪些插件」，不带路径与连接（路径不出主进程）。
 */
import type { MediaWallItem } from '../media'
import type { ActorDetail, ActorSummary } from './detail'
import type { ActorGender } from './gender'
import type { ActorImageKind } from './image'

/** 列表排序：最近更新 / 姓名 / 作品数 */
export type ActorSort = 'updated' | 'name' | 'films'

export const ACTOR_SORTS: readonly ActorSort[] = ['updated', 'name', 'films']

export const ACTOR_SORT_LABELS: Readonly<Record<ActorSort, string>> = {
  updated: '最近更新',
  name: '姓名',
  films: '作品数'
}

/** 列表页可选的每页条数与默认值 */
export const ACTOR_PAGE_SIZES: readonly number[] = [30, 60, 120]
export const ACTOR_LIST_PAGE_SIZE = 60

export interface ActorListRequest {
  /** 姓名 / 别名模糊匹配；空串表示不过滤 */
  keyword: string
  /** 用户标签精确匹配；空串表示不过滤 */
  tag: string
  sort: ActorSort
  offset: number
  limit: number
}

export interface ActorListResult {
  items: ActorSummary[]
  /** 过滤后的总数 */
  total: number
  /** 库里出现过的全部用户标签，供筛选器直接列出 */
  tags: string[]
}

export interface ActorDetailRequest {
  actorId: string
}

export interface ActorDetailResult {
  actor: ActorDetail
  /** 该演员的出演作品，按条目入库时间倒序 */
  films: MediaWallItem[]
}

/** 保存（新增或更新）演员的用户设定数据 */
export interface ActorSaveRequest {
  /** 空串表示新增 */
  actorId: string
  name: string
  aliases: string[]
  gender: ActorGender
  birthday: string
  birthCountry: string
  birthProvince: string
  birthCity: string
  birthCounty: string
  height: number
  bust: number
  waist: number
  hip: number
  cup: string
  tagline: string
  sourceUrl: string
  overview: string
  tags: string[]
  locked: boolean
}

export interface ActorSaveResult {
  actorId: string
}

export interface ActorRemoveRequest {
  actorId: string
}

export interface ActorImageImportRequest {
  actorId: string
  /** 用户在本机选中的图片绝对路径；主进程逐个校验后复制进数据目录 */
  paths: string[]
  kind: ActorImageKind
}

/** 单张图片导入失败：文件级失败不影响其它文件 */
export interface ActorImageImportFailure {
  path: string
  reason: string
}

export interface ActorImageImportResult {
  /** 成功导入的图片（按导入顺序） */
  images: ActorImageImportResultItem[]
  failed: ActorImageImportFailure[]
}

export interface ActorImageImportResultItem {
  imageId: string
  url: string
}

export interface ActorImageRequest {
  actorId: string
  imageId: string
}

/** 抓取演员资料：`pluginIds` 为空表示用全部「启用且实现演员钩子」的插件 */
export interface ActorScrapeRequest {
  actorId: string
  pluginIds: string[]
}

export interface ActorScrapeResult {
  /** 本次真正填上的字段名（中文，用于提示） */
  filled: string[]
  /** 本次保存的图片数 */
  images: number
  /** 结果说明；没有可用插件等情况下也走这里 */
  message: string
}

export interface ActorScrapeMissingResult {
  queued: number
  message: string
}

/**
 * 演员资料补全队列的实时状态（概览页进度卡用）。
 *
 * 契约：
 * - 队列只在主进程内存里，重启即清零；跑空后保留最近一轮的数字，直到下一轮排队时重置；
 * - 一次抓取的结果是「成功 / 失败 / 被取消」，`finished` 是三者之和，`failed` 只统计真正报错的；
 * - 事件与快照同形（全量状态，不做字段合并），渲染层覆盖本地值即可。
 */
export interface ActorScrapeStatus {
  /** 本轮排队的演员总数（队列未跑空时追加入队的批次会累加） */
  total: number
  /** 已处理完的演员数（成功 + 失败 + 被取消） */
  finished: number
  /** 其中抓取失败的演员数 */
  failed: number
  /** 队列里还没轮到的演员数（含正在抓的那一位） */
  pending: number
  /** 队列是否正在工作 */
  running: boolean
  /** 正在抓取的演员姓名；没有在跑时为空串 */
  currentName: string
  /** 最近一次状态变化时间；0 表示本次进程还没排过队 */
  updatedAt: number
}
