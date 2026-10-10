/**
 * 详情页两块信息格的字段口径（纯函数）。
 *
 * 契约：只决定「取哪个字段、怎么格式化」，不取数、不持有状态；
 * 字段口径与 NFO 写入侧保持一致，避免同名字段两边解释不同。
 */
import type { MediaDetailResult, MediaWallItem } from '@common/types/media'
import { formatDuration, formatSize, formatTime } from '@/utils/format'

/** 一格键值；`wide` 表示长文本占满整行 */
export interface DetailCell {
  label: string
  value: string
  wide?: boolean
}

/** 刮削状态：靠同目录产出判定「已刮削」时没有刮削时间可显示 */
export function scrapedText(item: MediaWallItem): string {
  if (!item.scraped) return '未刮削'
  return item.scrapedAt > 0 ? `已刮削 · ${formatTime(item.scrapedAt)}` : '已刮削'
}

/** 磁盘上的事实：这条记录是什么、在哪、多大 */
export function fileCells(detail: MediaDetailResult, sourceName: string): DetailCell[] {
  const { item } = detail
  return [
    { label: '标题', value: item.title || '—', wide: true },
    { label: '番号', value: item.num || '未识别' },
    { label: '数据源', value: sourceName || '未知数据源' },
    { label: '文件名', value: item.name, wide: true },
    { label: '所在目录', value: item.dirPath || '—', wide: true },
    { label: '体积', value: formatSize(item.size) },
    { label: '磁盘修改时间', value: formatTime(item.modifiedAt) },
    { label: '刮削状态', value: scrapedText(item) }
  ]
}

/** NFO 里的元信息：没有 NFO 时返回空数组，由调用方决定展示什么 */
export function nfoCells(detail: MediaDetailResult): DetailCell[] {
  const meta = detail.meta
  if (!meta) return []
  return [
    { label: '标题', value: meta.title || '—', wide: true },
    { label: '番号', value: meta.num || '—' },
    { label: '原名', value: meta.originalTitle || '—' },
    { label: '发行日期', value: meta.releaseDate || '—' },
    { label: '时长', value: formatDuration(meta.duration) },
    { label: '片商', value: meta.maker || '—' },
    { label: '厂牌', value: meta.label || '—' },
    { label: '系列', value: meta.series || '—' },
    { label: '导演', value: meta.director || '—' },
    { label: '演员', value: meta.actors.join('、') || '—', wide: true },
    { label: '标签', value: meta.tags.join('、') || '—', wide: true }
  ]
}
