/**
 * 影视墙（媒体库）的公共形状。
 *
 * 契约：
 * - 墙面以磁盘上的视频为准（`resource` 表），刮削记录（`scrape_file`）只用来补标题与封面，
 *   所以磁盘上删掉的影片会自动从墙上消失；
 * - 路径一律是连接内绝对路径，封面与播放地址一律是 `storage://` 协议地址（封面空串表示没有封面）；
 * - 播放地址由主进程用资源 ID 构造，渲染层拿不到磁盘路径、也构造不出越权地址。
 * - 跨数据源靠 `connectionId` 区分，同名路径的不同存储不会互相污染。
 */
import type { MediaNfoMeta } from './nfo'

export { parseNfoXml } from './nfo'
export type { MediaNfoMeta } from './nfo'
export * from './error'
export * from './result'

/** 墙上的一张卡：磁盘上的一个视频 + 能补上的刮削信息 */
export interface MediaWallItem {
  connectionId: string
  /** 视频在连接内的绝对路径 */
  path: string
  /** 所在目录（连接内绝对路径） */
  dirPath: string
  /** 文件名（含扩展名） */
  name: string
  /** 番号，识别不到时为空串 */
  num: string
  /** 展示标题：优先刮削命中的插件标题，否则是去掉扩展名的文件名 */
  title: string
  /** 封面地址（`storage://`），空串表示没有封面 */
  coverUrl: string
  /** 播放地址（`storage://`），可直接喂给 video / artplayer；只有索引里存在这个视频时才非空 */
  playUrl: string
  /** 是否匹配到刮削记录 */
  scraped: boolean
  /** 匹配到的刮削记录更新时间；未匹配为 0（仅用于排序） */
  scrapedAt: number
  /** 命中的插件 ID，未命中为空串 */
  pluginId: string
  size: number
  modifiedAt: number
}

/** 一次拉全的整墙：筛选 / 排序 / 分页都在渲染层做 */
export interface MediaWallResult {
  items: MediaWallItem[]
  /** 视频总数（当前等于 items.length，保留字段以便将来改成分页） */
  total: number
  /** 其中匹配到刮削记录的数量 */
  scrapedCount: number
  /** 资源索引里最新的索引时间；没有任何资源时为 0 */
  indexedAt: number
}

export interface MediaDetailRequest {
  connectionId: string
  /** 视频在连接内的绝对路径 */
  path: string
}

export interface MediaDetailResult {
  /** 与墙上同一套解析结果；找不到该视频时主进程直接报错，不会返回空 item */
  item: MediaWallItem
  /** 同目录 NFO 的解析结果；没有 NFO 或解析失败时为 null */
  meta: MediaNfoMeta | null
  /** 实际读到的 NFO 路径；没读到为空串 */
  nfoPath: string
}
