/**
 * 详情页的展示口径：把详情结果与连接列表折算成模板直接能用的一串值。
 *
 * 契约：
 * - `detail` 为 null（没读到 / 读失败）时不抛异常、一律给空值，模板照常渲染，读没读出来的分支交给页面；
 * - 连接归属从详情结果反查（路由只带影片身份、不带路径），找不到连接时 `connection` 为 null；
 * - NSFW 保护以总开关为前提，命中「该存储 nsfw 标记」或「所属资料库的 nsfwProtection」任一即遮罩，
 *   总开关关闭时一律显示；
 * - 两个信息区块各管一段：「影片信息」只放刮削下来的片商 / 厂牌 / 系列 / 导演（没有内容时整个区块不渲染），
 *   「文件信息」只放文件本身的事实；取数在 `useMediaDetail`，写操作（重新读取 / 还原刮削前）留在页面。
 */
import { computed } from 'vue'
import type { Ref } from 'vue'
import type { FileConnection } from '@common/types/file'
import type { MediaDetailResult } from '@common/types/media'
import { useNsfwProtection } from '@/hooks/UseNsfwProtection'
import { formatSize } from '@/utils/format'
import {
  fileCells as fileCellsOf,
  infoCells as infoCellsOf,
  stillImagesOf
} from '../mediaDetailCells'

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
  /** 最终遮罩口径：总开关为前提，存储标记或库级 nsfwProtection 命中即遮罩 */
  const { protect } = useNsfwProtection(connection, () => detail.value?.item.nsfwProtected === true)
  const sourceName = computed(() => connection.value?.name ?? '')
  const fileCells = computed(() => (detail.value ? fileCellsOf(detail.value, sourceName.value) : []))
  const infoCells = computed(() => (detail.value ? infoCellsOf(detail.value) : []))
  const stillImages = computed(() => (detail.value ? stillImagesOf(detail.value) : []))
  /** 剧情简介：刮削写了才单独成块，没写就不占位 */
  const plot = computed(() => detail.value?.meta.plot.trim() ?? '')
  /** 这条记录是整部剧集（详情页据此换文案、显示选集） */
  const isSeries = computed(() => detail.value?.item.type === 'series')
  /** 元信息区块的标题：影片与剧集分别称呼，区块里只放片商 / 厂牌 / 系列 / 导演 */
  const infoTitle = computed(() => (isSeries.value ? '剧集信息' : '影片信息'))
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
    fileCells,
    infoCells,
    infoTitle,
    stillImages,
    plot,
    posterUrl,
    posterTitle,
    posterNote,
    noSourceHint
  }
}
