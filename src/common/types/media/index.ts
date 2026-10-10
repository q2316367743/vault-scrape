/**
 * 影视墙（媒体库）的公共形状。
 *
 * 契约：
 * - 墙面以 `media_item`（条目）为准，一个视频文件 = 一个 Movie 条目；
 *   条目属于哪个资料库是**真实外键**（`libraryId`），不再按路径前缀推导；
 * - 元数据（标题、简介、番号、图片）来自刮削结果，写在条目与 `media_image` 上，
 *   所以重扫不会丢元数据，磁盘上删掉的影片会在扫描清理时从墙上消失；
 * - 路径一律是连接内绝对路径，封面与播放地址一律是 `storage://` 协议地址（封面空串表示没有封面）；
 * - 播放地址由主进程用媒体源 ID 构造，渲染层拿不到磁盘路径、也构造不出越权地址。
 */
import type { MediaLibrarySummary } from '../library'
import type { MediaNfoMeta } from './nfo'

export { parseNfoXml } from './nfo'
export type { MediaNfoMeta } from './nfo'
export type { MediaLibrarySummary } from '../library'
export * from './error'
export * from './result'
export * from './source'

/** 墙上的一张卡：一个 Movie 条目 + 它的媒体源与封面 */
export interface MediaWallItem {
  /** 条目 ID（`media_item.id`），详情页与手动刮削都用它定位 */
  itemId: string
  /** 所属资料库 ID；条目一定属于某个库，这里不会是空串 */
  libraryId: string
  /** 所属资料库名称，未归库（历史数据）时为空串 */
  libraryName: string
  /** 所属资料库是否按敏感内容处理；与全局开关、存储的 nsfw 标记任一命中即遮罩封面 */
  nsfwProtected: boolean
  connectionId: string
  /** 主媒体源在连接内的绝对路径 */
  path: string
  /** 所在目录（连接内绝对路径） */
  dirPath: string
  /** 文件名（含扩展名） */
  name: string
  /** 番号，识别不到时为空串 */
  num: string
  /** 展示标题：优先刮削命中标题，否则是去掉扩展名的文件名 */
  title: string
  /** 封面地址（`storage://`），空串表示没有封面 */
  coverUrl: string
  /** 播放地址（`storage://`），可直接喂给 video / artplayer */
  playUrl: string
  /** 上次命中的插件 ID，未命中为空串 */
  pluginId: string
  /** 条目入库时间（首次被扫描到的时间），「最近添加」按它排序 */
  dateAdded: number
  size: number
  modifiedAt: number
}

/** 墙面筛选：只列某个资料库的影片 */
export interface MediaWallRequest {
  /** 资料库 ID；空串表示全部资料库 */
  libraryId: string
}

/** 首页横排的 ID：最近添加 / 推荐（均匀取样，避免整排与最近添加重复） */
export type MediaHomeRowId = 'recent' | 'discover'

/** 首页的一横排：标题 + 最多 `MEDIA_HOME_ROW_LIMIT` 张卡 */
export interface MediaHomeRow {
  id: MediaHomeRowId
  title: string
  items: MediaWallItem[]
}

/**
 * 影视墙首页（Jellyfin 风格）：上排是资料库卡片，下面是若干横排。
 *
 * 契约：这里只做「取数与截断」，排序在渲染层不再重排；
 * 各排的条目可能重叠（同一部影片可以同时在「最近添加」和「推荐」里），
 * 但排与排的取样口径不同，不会出现两排内容完全一样。
 */
export interface MediaHomeResult {
  libraries: MediaLibrarySummary[]
  rows: MediaHomeRow[]
  total: number
  indexedAt: number
}

/** 单排最多返回多少张卡 */
export const MEDIA_HOME_ROW_LIMIT = 24

/** 一次拉全的墙：筛选 / 排序 / 分页都在渲染层做；带 `libraryId` 时只含该库 */
export interface MediaWallResult {
  items: MediaWallItem[]
  /** 视频总数（当前等于 items.length，保留字段以便将来改成分页） */
  total: number
  /** 媒体库里最新的索引时间；没有任何条目时为 0 */
  indexedAt: number
  /**
   * 全部资料库（含 0 个视频的库），供墙面筛选器直接列出。
   *
   * 计数在这里算好，渲染层不再自己按前缀匹配。
   */
  libraries: MediaLibrarySummary[]
}

/** 资料库内的一个可浏览节点（工作台挑文件用） */
export interface MediaBrowseEntry {
  itemId: string
  /** 条目类型：`movie` 可刮削，`folder` 用于继续下钻 */
  type: 'movie' | 'folder'
  connectionId: string
  path: string
  name: string
  num: string
  title: string
  /** 文件夹条目：子树里是否有影片；影片条目：是否已经有媒体源 */
  hasSource: boolean
  size: number
  modifiedAt: number
}

export interface MediaDetailRequest {
  /** 条目 ID；主进程再解析出媒体源、目录与 NFO */
  itemId: string
}

export interface MediaDetailResult {
  /** 与墙上同一套解析结果；找不到该条目时主进程直接报错，不会返回空 item */
  item: MediaWallItem
  /** 同目录 NFO 的解析结果；没有 NFO 或解析失败时为 null */
  meta: MediaNfoMeta | null
  /** 实际读到的 NFO 路径；没读到为空串 */
  nfoPath: string
}
