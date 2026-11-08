/**
 * 影视墙首页的取数。
 *
 * 契约：
 * - 首页一次拿到「资料库摘要 + 两排影片（最近添加 / 推荐）」，
 *   排序与每排上限都由主进程决定，渲染层只管展示；
 * - 只有失败才写 `failure`：没有任何资料库 / 没有任何影片都是正常状态；
 * - 摘要用的 total / indexedAt 是全库口径，不是某一排的数量。
 */
import { ref } from 'vue'
import { mediaApi } from '@/api'
import type { MediaLibrarySummary } from '@common/types/library'
import type { MediaHomeRow } from '@common/types/media'

export function useMediaHome() {
  const libraries = ref<MediaLibrarySummary[]>([])
  const rows = ref<MediaHomeRow[]>([])
  const loading = ref(false)
  const failure = ref('')
  const total = ref(0)
  /** 资源索引里最新的索引时间，0 表示还没有任何资源 */
  const indexedAt = ref(0)

  async function load(): Promise<void> {
    loading.value = true
    failure.value = ''
    const result = await mediaApi.home()
    loading.value = false
    if (!result.ok) {
      failure.value = result.message
      return
    }
    libraries.value = result.data.libraries
    rows.value = result.data.rows
    total.value = result.data.total
    indexedAt.value = result.data.indexedAt
  }

  return {
    libraries,
    rows,
    loading,
    failure,
    total,
    indexedAt,
    load
  }
}
