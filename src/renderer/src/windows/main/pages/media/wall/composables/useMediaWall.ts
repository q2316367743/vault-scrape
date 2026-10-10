/**
 * 单个资料库内容页的取数与视图状态。
 *
 * 契约：
 * - 库由路由决定（`libraryId` 为空串表示「全部影片」），取数时原样交给主进程：
 *   渲染层不再自己按库过滤，也不再提供资料库下拉；
 * - 整库一次拉全，搜索与排序在渲染层做，主进程不复制排序规则；
 * - 只有失败才写 `failure`，成功的空结果是正常状态（这个库里就是没有视频）；
 * - 排序默认「按磁盘时间（最新在前）」；
 * - 列表以 `itemId` 去重并作为渲染 key：影片身份是「库 + 源文件」，路径不再参与身份判定。
 */
import { computed, ref, watch, type Ref } from 'vue'
import { mediaApi } from '@/api'
import type { MediaWallItem } from '@common/types/media'

/** 排序口径：按标题 / 体积 / 磁盘修改时间（不按刮削情况分类） */
export type MediaSortKey = 'title' | 'size' | 'modified'

function comparatorOf(sort: MediaSortKey): (left: MediaWallItem, right: MediaWallItem) => number {
  if (sort === 'title') return (left, right) => left.title.localeCompare(right.title, 'zh-Hans-CN')
  if (sort === 'size') return (left, right) => right.size - left.size
  return (left, right) => right.modifiedAt - left.modifiedAt
}

/** 主进程理论上已按 itemId 去重，渲染层再兜一次：重复条目会让 key 冲突 */
function dedupeByItemId(items: MediaWallItem[]): MediaWallItem[] {
  const seen = new Set<string>()
  const result: MediaWallItem[] = []
  for (const item of items) {
    if (item.itemId.length === 0 || seen.has(item.itemId)) continue
    seen.add(item.itemId)
    result.push(item)
  }
  return result
}

export function useMediaWall(libraryId: Ref<string>) {
  const items = ref<MediaWallItem[]>([])
  const loading = ref(false)
  const failure = ref('')
  /** 资源索引里最新的索引时间，0 表示还没有任何资源 */
  const indexedAt = ref(0)

  const keyword = ref('')
  const sort = ref<MediaSortKey>('modified')

  async function load(): Promise<void> {
    loading.value = true
    failure.value = ''
    const result = await mediaApi.wall({ libraryId: libraryId.value })
    loading.value = false
    if (!result.ok) {
      failure.value = result.message
      return
    }
    items.value = dedupeByItemId(result.data.items)
    indexedAt.value = result.data.indexedAt
  }

  // 换库（路由 query 变化）时自动重拉；初次挂载也走这里
  watch(
    libraryId,
    () => {
      void load()
    },
    { immediate: true }
  )

  /** 搜索命中标题 / 番号 / 文件名三者之一 */
  const visible = computed(() => {
    const text = keyword.value.trim().toLowerCase()
    const filtered = items.value.filter((item) => {
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
    sort,
    visible,
    load
  }
}
