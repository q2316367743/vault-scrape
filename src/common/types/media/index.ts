/**
 * 影视墙（媒体库）的公共形状。
 *
 * 契约：
 * - 墙面以 `media_item`（条目）为准，影视库一个**影片目录**（或库根下的单个视频）= 一个 Movie 条目，
 *   同一目录里以目录名为前缀的多个视频是该条目的多个版本（多个媒体源）；
 *   条目属于哪个资料库是**真实外键**（`libraryId`），不再按路径前缀推导；
 * - 元数据（标题、简介、番号、图片）来自刮削结果与扫描读到的 NFO，写在条目与 `media_image` 上，
 *   所以重扫不会丢元数据，磁盘上删掉的影片会在扫描清理时从墙上消失；
 * - 路径一律是连接内绝对路径，封面与播放地址一律是 `storage://` 协议地址（封面空串表示没有封面）；
 * - 播放地址由主进程用媒体源 ID 构造，渲染层拿不到磁盘路径、也构造不出越权地址；
 * - 目录 / 文件名规则（年份、版本标签、季集号、花絮识别）见 `./mediaRules`。
 */
import type { MediaLibrarySummary } from '../library'
import type { MediaItemTranslation } from '../translate'
import type { MediaImageType } from './source'

export { parseNfoRestore, parseNfoXml } from './nfo'
export type { MediaNfoMeta, NfoKind, NfoRestoreFile, NfoRestoreInfo } from './nfo'
export type { MediaLibrarySummary } from '../library'
export * from './error'
export * from './mediaRules'
export * from './result'
export * from './source'

/** 墙上的一张卡：影视库是一个 Movie 条目，剧集库是一个 Series 条目（整个剧集） */
export interface MediaWallItem {
  /** 条目 ID（`media_item.id`），详情页与手动刮削都用它定位 */
  itemId: string
  /** 条目类型：影视库是 `movie`（一个视频文件一张卡），剧集库是 `series`（一个剧集一张卡） */
  type: 'movie' | 'series'
  /** 所属资料库 ID；条目一定属于某个库，这里不会是空串 */
  libraryId: string
  /** 所属资料库名称，未归库（历史数据）时为空串 */
  libraryName: string
  /** 所属资料库是否按敏感内容处理；应用设置的全局开关与它同时成立才遮罩封面 */
  nsfwProtected: boolean
  connectionId: string
  /** 主媒体源在连接内的绝对路径；剧集条目就是剧集目录 */
  path: string
  /** 所在目录（连接内绝对路径）；剧集条目就是剧集目录本身 */
  dirPath: string
  /** 文件名（含扩展名）；剧集条目是剧集目录名 */
  name: string
  /** 番号，识别不到时为空串；剧集条目固定为空串 */
  num: string
  /** 展示标题：优先刮削命中标题，否则是去掉扩展名的文件名 */
  title: string
  /** 封面地址（`storage://`），空串表示没有封面 */
  coverUrl: string
  /** 播放地址（`storage://`），可直接喂给 video / artplayer；**剧集条目为空串**（选集后才有的地址） */
  playUrl: string
  /** 剧集条目的季数；影片固定为 0 */
  seasonCount: number
  /** 剧集条目的集数；影片固定为 0 */
  episodeCount: number
  /** 上次命中的插件 ID，未命中为空串 */
  pluginId: string
  /** 条目入库时间（首次被扫描到的时间），「最近添加」按它排序 */
  dateAdded: number
  /** 磁盘体积（字节）；剧集条目是整部剧集的集文件体积合计 */
  size: number
  /** 磁盘修改时间；剧集条目取集文件里最新的那个 */
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

/** 资料库内的一个可浏览节点（目录浏览用） */
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

/** 影片详情页里的一条参演演员：只够画「头像 + 名字」，点进去看完整资料 */
export interface MediaActorRef {
  actorId: string
  name: string
  /** 头像地址（`storage://actor/...`），没有头像为空串 */
  avatarUrl: string
}

/**
 * 详情页里的一张图（沉浸头部的背景大图、剧照墙的缩略图都从这里取）。
 *
 * 契约：`url` 是 `storage://` 地址，只能喂给 tdesign 的图片组件，渲染层不解析它；
 * `type` 是刮削写下的用途，同一地址只会出现一次。
 */
export interface MediaDetailImage {
  type: MediaImageType
  url: string
}

/**
 * 详情页的元信息：**全部来自本地库**（`media_item` 的刮削列）。
 *
 * 契约：主进程从库里组装，详情页不再为此读磁盘 NFO —— 刮削（插件）与扫描（NFO）
 * 都会把这几个字段落库，所以列表与详情看到的是同一份数据，进详情页不产生磁盘 / 网络往返。
 * 没刮削过的条目各字段是空值（空串 / 0 / 空数组），渲染层按「没内容就不画」处理。
 */
export interface MediaDetailMeta {
  /** 展示名（刮削标题）；没刮过时是空串，渲染层回落到 `item.name` */
  title: string
  /** 番号 */
  num: string
  /** 原名 */
  originalTitle: string
  /** 简介 */
  plot: string
  /** 片商 */
  maker: string
  /** 厂牌 */
  label: string
  /** 系列 */
  series: string
  /** 导演 */
  director: string
  /** 发行日期（`YYYY-MM-DD`） */
  releaseDate: string
  /** 时长（分钟），0 表示没读到 */
  duration: number
  /** 标签 */
  tags: string[]
}

export interface MediaDetailResult {
  /** 与墙上同一套解析结果；找不到该条目时主进程直接报错，不会返回空 item */
  item: MediaWallItem
  /** 库里的元信息；没刮削过的条目各字段为空值 */
  meta: MediaDetailMeta
  /** 该影片的参演演员，按出演顺序；没有演员时为空数组 */
  actors: MediaActorRef[]
  /**
   * 这部影片的全部图片：条目自己的在前、同目录（父条目）的兜底图在后，各自按用途排序。
   *
   * 契约：与封面同一套归属规则（父目录的图会被同目录多部影片共用），按地址去重；
   * 一张图都没有时是空数组，封面仍以 `item.coverUrl` 为准。
   */
  images: MediaDetailImage[]
  /**
   * 剧集的分季分集结构：按季号升序，每季里按集号升序；影片固定为空数组。
   *
   * 契约：这里只放「有媒体源能播」的集，播放地址就是集的 `playUrl`；
   * 剧集条目自己的 `item.playUrl` 是空串，渲染层要播哪一集由用户选。
   */
  seasons: MediaSeasonRef[]
  /**
   * 这个条目的译文；没翻译过是 `null`。
   *
   * 契约：译文是派生物、**原文不受影响**，两者一起下发，详情页自己切「原文 / 译文」；
   * 各字段是空串 / 空数组表示「这个字段没有译文」，渲染层按字段回落原文。
   */
  translation: MediaItemTranslation | null
}

/** 剧集详情里的一集：只够画一个选集条目并直接播放 */
export interface MediaEpisodeRef {
  itemId: string
  seasonNumber: number
  episodeNumber: number
  /** 展示标题：刮削命中集名时是集名，否则是「第 N 集」 */
  title: string
  /** 集简介；刮削结果里没有时为「」，渲染层不要回退到剧集简介 */
  overview: string
  /** 时长（分钟）；未知为 0 */
  runtimeMinutes: number
  /** 首播日期（`YYYY-MM-DD`）；未知为空串 */
  premiereDate: string
  /** 播放地址（`storage://`），可直接喂给播放器 */
  playUrl: string
  /** 剧照地址（`storage://`）：集的图 → 季海报 → 剧集封面，全没有时为空串 */
  coverUrl: string
  /** 集文件在连接内的绝对路径 */
  path: string
  /** 集文件体积（字节） */
  size: number
  /** 这一集的译文；没翻译过是 `null`。集只翻简介，标题保持原文 */
  translation: MediaItemTranslation | null
}

/** 剧集详情里的一季：海报 + 该季的全部集 */
export interface MediaSeasonRef {
  itemId: string
  seasonNumber: number
  /** 季目录名（如 `Season 01`）；特别篇是「特别篇」 */
  name: string
  /** 季海报地址（`storage://`），没有为空串（渲染层可退回剧集封面） */
  posterUrl: string
  episodes: MediaEpisodeRef[]
}

export interface MediaClearNfoRequest {
  /** 条目 ID；主进程据此找主源、目录与同目录 NFO */
  itemId: string
}

/**
 * 「还原刮削前」（通道 `media:clear-nfo`）的结果：库内刮削数据已清空，NFO 与刮削写下的附属文件已尽量删掉，
 * 视频 / 集文件按 NFO 里的「刮削前位置」记录改回名 / 移回原目录。
 *
 * 契约：`removedNfo` / `removedAssets` / `restoredAssets` 都是**真的改动过**的磁盘路径，
 * 磁盘上本来就没有对应文件时是空数组（不算失败）；演员档案（`actor`）一律不动。
 */
export interface MediaClearNfoResult {
  itemId: string
  /** 被删掉的 NFO 文件在连接内的绝对路径（影片：`movie.nfo` 与 `<视频基础名>.nfo`；剧集：`tvshow.nfo`、`season.nfo`、每集 NFO） */
  removedNfo: string[]
  /** 被删掉的刮削产物（图片 / 预告片）在连接内的绝对路径 */
  removedAssets: string[]
  /** 被搬回刮削前位置的本地图片在连接内的绝对路径（目标已存在时不动它） */
  restoredAssets: string[]
  /** 文件是否回到了刮削前的记录位置；NFO 里没有可用记录（或没处可放）时为 false */
  restored: boolean
  /** 还原后的路径：影片是视频路径，剧集是剧集目录；没还原时就是清除前的路径 */
  path: string
  /** 删掉的搬空目录在连接内的绝对路径（影片目录，或剧集的季目录 / 集目录）；没删时为空数组 */
  removedDirs: string[]
}
