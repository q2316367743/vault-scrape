/**
 * 详情页的展示口径：把详情结果与连接列表折算成模板直接能用的一串值。
 *
 * 契约：
 * - `detail` 为 null（没读到 / 读失败）时不抛异常、一律给空值，模板照常渲染，读没读出来的分支交给页面；
 * - 连接归属从详情结果反查（路由只带影片身份、不带路径），找不到连接时 `connection` 为 null；
 * - NSFW 保护按「全局开关 + 该存储 nsfw 标记 + 所属资料库的 nsfwProtection」判定，任一命中即遮罩；
 * - 这一层只做口径折算：取数在 `useMediaDetail`，写操作（重新读取 / 还原刮削前）留在页面。
 */
import { computed } from 'vue'
import type { Ref } from 'vue'
import type { FileConnection } from '@common/types/file'
import type { MediaDetailResult } from '@common/types/media'
import { useNsfwProtection } from '@/hooks/UseNsfwProtection'
import { formatSize } from '@/utils/format'
import { fileCells, stillImagesOf } from '../mediaDetailCells'

export function useDetailView(
  detail: Ref<MediaDetailResult | null>,
  connections: Ref<FileConnection[]>
) {
  /** 连接归属从详情结果反查：路由只带影片身份，不带路径 */
  const connection = computed(() => {
    const id = detail.value?.item.connectionId
    if (id === undefined || id.length === 0) return null
    return connections.value.find((item) => item.id === id) ?? null
  })
  const { active } = useNsfwProtection(connection)
  /** 全局开关 + 存储标记命中，或所属资料库自己要求按敏感内容处理 */
  const protect = computed(() => active.value || detail.value?.item.nsfwProtected === true)
  const sourceName = computed(() => connection.value?.name ?? '')
  const factCells = computed(() => (detail.value ? fileCells(detail.value, sourceName.value) : []))
  const stillImages = computed(() => (detail.value ? stillImagesOf(detail.value) : []))
  /** 剧情简介：只在 NFO 里写了的时候单独成块，没写就不占位 */
  const plot = computed(() => detail.value?.meta?.plot.trim() ?? '')
  /** 这条记录是整部剧集（详情页据此换文案、显示选集） */
  const isSeries = computed(() => detail.value?.item.type === 'series')
  /** 封面块：头部用封面兜底时是模糊的，这里给一张清晰的 */
  const posterUrl = computed(() => detail.value?.item.coverUrl ?? '')
  const posterTitle = computed(() => {
    const item = detail.value?.item
    if (!item) return ''
    return item.title || (item.type === 'series' ? '未命名剧集' : '未命名影片')
  })
  const posterNote = computed(() => {
    const item = detail.value?.item
    if (!item) return ''
    const parts =
      item.type === 'series'
        ? [`${item.seasonCount} 季`, `${item.episodeCount} 集`, formatSize(item.size)]
        : [item.num, formatSize(item.size)]
    return parts.filter((part) => part.length > 0).join(' · ')
  })
  /** 播放器拿不到地址时的提示：剧集的空来自「一集都不可播」，说法与影片不同 */
  const noSourceHint = computed(() =>
    isSeries.value
      ? '这部剧集里还没有能播放的集，请回影视墙刷新后再试'
      : '没有找到这个影片的播放地址，请回影视墙刷新后再试'
  )

  return {
    connection,
    protect,
    isSeries,
    sourceName,
    factCells,
    stillImages,
    plot,
    posterUrl,
    posterTitle,
    posterNote,
    noSourceHint
  }
}
