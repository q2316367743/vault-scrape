/**
 * 详情页两块信息格的字段口径（纯函数）。
 *
 * 契约：只决定「取哪个字段、怎么格式化」，不取数、不持有状态；
 * 字段口径与 NFO 写入侧保持一致，避免同名字段两边解释不同。
 */
import type { MediaDetailImage, MediaDetailResult, MediaImageType } from '@common/types/media'
import { formatDuration, formatSize, formatTime } from '@/utils/format'

/** 一格键值（左标签右值的一行，长值自己换行） */
export interface DetailCell {
  label: string
  value: string
}

/** 磁盘上的事实：这条记录是什么、在哪、多大（剧集按整部剧统计） */
export function fileCells(detail: MediaDetailResult, sourceName: string): DetailCell[] {
  const { item } = detail
  if (item.type === 'series') {
    return [
      { label: '标题', value: item.title || '—' },
      { label: '剧集目录', value: item.name },
      { label: '季数', value: `${item.seasonCount} 季` },
      { label: '集数', value: `${item.episodeCount} 集` },
      { label: '数据源', value: sourceName || '未知数据源' },
      { label: '所在目录', value: item.dirPath || '—' },
      { label: '体积', value: formatSize(item.size) },
      { label: '磁盘修改时间', value: formatTime(item.modifiedAt) }
    ]
  }
  return [
    { label: '标题', value: item.title || '—' },
    { label: '番号', value: item.num || '未识别' },
    { label: '数据源', value: sourceName || '未知数据源' },
    { label: '文件名', value: item.name },
    { label: '所在目录', value: item.dirPath || '—' },
    { label: '体积', value: formatSize(item.size) },
    { label: '磁盘修改时间', value: formatTime(item.modifiedAt) }
  ]
}

/** NFO 里的元信息：没有 NFO 时返回空数组，由调用方决定展示什么 */
export function nfoCells(detail: MediaDetailResult): DetailCell[] {
  const meta = detail.meta
  if (!meta) return []
  return [
    { label: '标题', value: meta.title || '—' },
    { label: '番号', value: meta.num || '—' },
    { label: '原名', value: meta.originalTitle || '—' },
    { label: '发行日期', value: meta.releaseDate || '—' },
    { label: '时长', value: formatDuration(meta.duration) },
    { label: '片商', value: meta.maker || '—' },
    { label: '厂牌', value: meta.label || '—' },
    { label: '系列', value: meta.series || '—' },
    { label: '导演', value: meta.director || '—' },
    { label: '演员', value: meta.actors.join('、') || '—' },
    { label: '标签', value: meta.tags.join('、') || '—' }
  ]
}

/** 沉浸头部的一行要点（只列真正有值的项，没 NFO 时只剩磁盘事实） */
export interface HeroFact {
  label: string
  value: string
}

/**
 * 头部要点：番号 / 发行日期 / 时长 / 片商 / 厂牌 / 系列 / 导演 / 体积；
 * 剧集换一套口径：季数 / 集数 / 首播日期 / 片商 / 厂牌 / 体积（NFO 是 `tvshow.nfo`）。
 *
 * 契约：没有值的项直接不出现（不显示「—」），所以头部在未刮削时不会变成一排占位符。
 */
export function heroFacts(detail: MediaDetailResult): HeroFact[] {
  const meta = detail.meta
  const facts: HeroFact[] = []
  const push = (label: string, value: string): void => {
    if (value.length > 0) facts.push({ label, value })
  }
  if (detail.item.type === 'series') {
    push('季数', detail.item.seasonCount > 0 ? `${detail.item.seasonCount} 季` : '')
    push('集数', detail.item.episodeCount > 0 ? `${detail.item.episodeCount} 集` : '')
    push('首播日期', meta?.releaseDate ?? '')
    push('片商', meta?.maker ?? '')
    push('厂牌', meta?.label ?? '')
    push('体积', formatSize(detail.item.size))
    return facts
  }
  push('番号', detail.item.num || meta?.num || '')
  push('发行日期', meta?.releaseDate ?? '')
  push('时长', meta && meta.duration > 0 ? formatDuration(meta.duration) : '')
  push('片商', meta?.maker ?? '')
  push('厂牌', meta?.label ?? '')
  push('系列', meta?.series ?? '')
  push('导演', meta?.director ?? '')
  push('体积', formatSize(detail.item.size))
  return facts
}

/** 头部标签：NFO 标签去空、去重并保持原顺序 */
export function heroTags(detail: MediaDetailResult): string[] {
  return [...new Set(detail.meta?.tags.filter((tag) => tag.length > 0) ?? [])]
}

/**
 * 头部能直接撑满的现成图片的优先级：缩略图 → 横幅 → 背景图 → 剧照。
 *
 * `thumb*`（该条目的官方横图）排最前，因为 `backdrop` 里混着 `extrafanart/fanartN` 这种
 * 竖版剧照（实测 fanart1.jpg 是 600×800），排在前面会把头部裁成一条；
 * 剩下的横竖由 `MediaDetailHero.vue` 按图片实际宽高兜底，类型口径见
 * `src/main/src/modules/media/mediaIndexer.ts`。
 */
const HERO_BACKDROP_TYPES: MediaImageType[] = ['thumb', 'banner', 'backdrop', 'still']

/**
 * 头部的现成横图：一张都没有时返回空串，头部据此**整条图片带都不渲染**、退成纯文字头部
 * （见 `MediaDetailHero.vue`）。这里不回退封面——竖版封面撑不成横幅。
 */
export function heroBackdropOf(detail: MediaDetailResult): string {
  for (const type of HERO_BACKDROP_TYPES) {
    const image = detail.images.find((row) => row.type === type)
    if (image) return image.url
  }
  return ''
}

/**
 * 剧照墙：主图 / 缩略图（封面与头部已经用过）与头部那张背景图本身都不再上墙，
 * 其余按主进程给的原顺序排列。
 */
export function stillImagesOf(detail: MediaDetailResult): MediaDetailImage[] {
  const backdrop = heroBackdropOf(detail)
  return detail.images.filter(
    (image) => image.type !== 'primary' && image.type !== 'thumb' && image.url !== backdrop
  )
}
