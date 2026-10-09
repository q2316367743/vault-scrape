/**
 * 影视墙的取数与视图状态。
 *
 * 契约：
 * - 整墙一次拉全（含所有数据源），筛选 / 搜索 / 排序全部在渲染层做，主进程不复制排序规则；
 * - 只有失败才写 `failure`，成功的空结果是正常状态（墙上就是没有视频）；
 * - 排序默认「已刮削优先」，同组内按刮削时间倒序，未刮削的排在最后。
 */
import { computed, ref } from 'vue'
import { mediaApi } from '@/api'
import type { MediaWallItem } from '@common/types/media'

/** 排序口径：默认按刮削情况，其余按标题 / 体积 / 磁盘修改时间 */
export type MediaSortKey = 'scraped' | 'title' | 'size' | 'modified'

/** 数据源筛选：`all` 表示不筛 */
export const MEDIA_SOURCE_ALL = 'all'

function comparatorOf(sort: MediaSortKey): (left: MediaWallItem, right: MediaWallItem) => number {
  if (sort === 'title') return (left, right) => left.title.localeCompare(right.title, 'zh-Hans-CN')
  if (sort === 'size') return (left, right) => right.size - left.size
  if (sort === 'modified') return (left, right) => right.modifiedAt - left.modifiedAt
  return (left, right) => {
    if (left.scraped !== right.scraped) return left.scraped ? -1 : 1
    return right.scrapedAt - left.scrapedAt
  }
}

export function useMediaWall() {
  const items = ref<MediaWallItem[]>([])
  const loading = ref(false)
  const failure = ref('')
  /** 资源索引里最新的索引时间，0 表示还没有任何资源 */
  const indexedAt = ref(0)

  const keyword = ref('')
  const sourceId = ref<string>(MEDIA_SOURCE_ALL)
  const sort = ref<MediaSortKey>('scraped')

  async function load(): Promise<void> {
    loading.value = true
    failure.value = ''
    const result = await mediaApi.wall()
    loading.value = false
    if (!result.ok) {
      failure.value = result.message
      return
    }
    items.value = result.data.items
    indexedAt.value = result.data.indexedAt
  }

  const scrapedCount = computed(() => items.value.filter((item) => item.scraped).length)

  /** 搜索命中标题 / 番号 / 文件名三者之一 */
  const visible = computed(() => {
    const text = keyword.value.trim().toLowerCase()
    const filtered = items.value.filter((item) => {
      if (sourceId.value !== MEDIA_SOURCE_ALL && item.connectionId !== sourceId.value) return false
      if (text.length === 0) return true
      return (
        item.title.toLowerCase().includes(text) ||
        item.num.toLowerCase().includes(text) ||
        item.name.toLowerCase().includes(text)
      )
    })
    return [...filtered].sort(comparatorOf(sort.value))
  })

  return {
    items,
    loading,
    failure,
    indexedAt,
    keyword,
    sourceId,
    sort,
    visible,
    scrapedCount,
    load
  }
}
