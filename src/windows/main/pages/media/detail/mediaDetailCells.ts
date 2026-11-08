/**
 * 详情页两块信息格的字段口径（纯函数）。
 *
 * 契约：只决定「取哪个字段、怎么格式化」，不取数、不持有状态；
 * 「影片信息」只列刮削下来的四个字段（片商 / 厂牌 / 系列 / 导演），别的字段头部已经有了，
 * 这里不再重复；「文件信息」只列文件本身的事实（文件名、位置、体积、时间、数据源）。
 */
import type { MediaDetailImage, MediaDetailResult, MediaImageType } from '@common/types/media'
import { formatDuration, formatSize, formatTime } from '@/utils/format'

/** 一格键值（左标签右值的一行，长值自己换行） */
export interface DetailCell {
  label: string
  value: string
}

/**
 * 文件信息：这条记录对应的文件是什么、在哪、多大（剧集按整部剧统计）。
 *
 * 契约：只列**文件本身**的事实，标题 / 番号 / 时长这类刮削信息不在这里重复
 * （头部要点与「影片信息」已经各管一段）。
 */
export function fileCells(detail: MediaDetailResult, sourceName: string): DetailCell[] {
  const { item } = detail
  const cells: DetailCell[] = [
    {
      label: item.type === 'series' ? '剧集目录' : '文件名',
      value: item.name
    },
    { label: '所在目录', value: item.dirPath || '—' },
    { label: '体积', value: formatSize(item.size) },
    { label: '修改时间', value: formatTime(item.modifiedAt) },
    { label: '数据源', value: sourceName || '未知数据源' }
  ]
  return cells
}

/**
 * 影片信息：刮削下来的片商 / 厂牌 / 系列 / 导演。
 *
 * 契约：没有值的行直接不出现（不显示「—」），一行都没有时返回空数组、
 * 由调用方整个区块都不渲染 —— 没刮削过的条目只有一个「文件信息」区块。
 */
export function infoCells(detail: MediaDetailResult): DetailCell[] {
  const meta = detail.meta
  const rows: DetailCell[] = [
    { label: '片商', value: meta.maker },
    { label: '厂牌', value: meta.label },
    { label: '系列', value: meta.series },
    { label: '导演', value: meta.director }
  ]
  return rows.filter((row) => row.value.length > 0)
}

/** 沉浸头部的一行要点（只列真正有值的项，没刮削过时只剩番号这类磁盘上能推断出来的） */
export interface HeroFact {
  label: string
  value: string
}

/**
 * 头部要点：番号 / 发行日期 / 时长；剧集换一套口径：季数 / 集数 / 首播日期。
 *
 * 契约：只放**一眼扫过去就要知道**的三两项，片商 / 厂牌 / 系列 / 导演归「影片信息」区块、
 * 体积与文件位置归「文件信息」区块，头部不再重复；没有值的项直接不出现（不显示「—」），
 * 所以未刮削时头部不会变成一排占位符。
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
    push('首播日期', meta.releaseDate)
    return facts
  }
  push('番号', detail.item.num || meta.num)
  push('发行日期', meta.releaseDate)
  push('时长', meta.duration > 0 ? formatDuration(meta.duration) : '')
  return facts
}

/** 头部标签：标签去空、去重并保持原顺序 */
export function heroTags(detail: MediaDetailResult): string[] {
  return [...new Set(detail.meta.tags.filter((tag) => tag.length > 0))]
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

/**
 * 译文视图：切到译文时，把详情里能翻的字段换成译文；**没有译文的位置一律回落原文**。
 *
 * 契约：
 * - 纯函数，返回的是**新对象**，原文（`detail`）不被改动，所以「切回原文」只是把原对象再传一遍；
 * - 主进程把原文与译文一起下发，本函数只在渲染层做一次字段覆盖，页面、头部、正文、
 *   两个信息区块与演员条都照常读同一套字段，**不必各自判一次有没有译文**；
 * - 覆盖的字段与自动翻译的字段范围一致：标题 / 原名 / 简介 / 片商 / 厂牌 / 系列 / 导演 /
 *   标签 / 演员名，剧集还包括每集的简介（集标题不翻译）；
 * - `tags` 与 `actors` 按**位置**对应原文（与主进程同一套口径），长度不够的位置保持原文。
 */
export function translatedDetail(detail: MediaDetailResult, showing: boolean): MediaDetailResult {
  const translation = detail.translation
  if (!showing || !translation) return detail
  /** 译文有值就用译文，空串 / 空数组留原文 */
  const pick = (translated: string, original: string): string =>
    translated.length > 0 ? translated : original
  const pickList = (translated: readonly string[], original: readonly string[]): string[] =>
    original.map((text, index) => pick(translated[index] ?? '', text))
  return {
    ...detail,
    item: { ...detail.item, title: pick(translation.title, detail.item.title) },
    meta: {
      ...detail.meta,
      title: pick(translation.title, detail.meta.title),
      originalTitle: pick(translation.originalTitle, detail.meta.originalTitle),
      plot: pick(translation.overview, detail.meta.plot),
      maker: pick(translation.maker, detail.meta.maker),
      label: pick(translation.label, detail.meta.label),
      series: pick(translation.series, detail.meta.series),
      director: pick(translation.director, detail.meta.director),
      tags: pickList(translation.tags, detail.meta.tags)
    },
    actors: detail.actors.map((actor, index) => ({
      ...actor,
      name: pick(translation.actors[index] ?? '', actor.name)
    })),
    seasons: detail.seasons.map((season) => ({
      ...season,
      episodes: season.episodes.map((episode) => {
        const row = episode.translation
        return row && row.overview.length > 0 ? { ...episode, overview: row.overview } : episode
      })
    }))
  }
}

