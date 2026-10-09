/**
 * 详情页取数：从路由 query 读「哪个存储的哪个文件」，向主进程要这一部影片的详情。
 *
 * 契约：
 * - 参数缺失（手改地址栏、旧书签）时只写中文 failure，不发请求、不抛异常；
 * - `load()` 可重复调用：重试时保留上一次的数据，只清错误提示；
 * - 详情里已经带了 `playUrl`，播放不需要额外请求。
 */
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { mediaApi } from '@/api'
import type { MediaDetailResult } from '@common/types/media'

export function useMediaDetail() {
  const route = useRoute()
  const connectionId = typeof route.query.connectionId === 'string' ? route.query.connectionId : ''
  const path = typeof route.query.path === 'string' ? route.query.path : ''

  const detail = ref<MediaDetailResult | null>(null)
  const loading = ref(false)
  const failure = ref('')

  async function load(): Promise<void> {
    if (connectionId.length === 0 || path.length === 0) {
      failure.value = '地址里缺少影片参数，请从影视墙点进来'
      return
    }
    loading.value = true
    failure.value = ''
    const result = await mediaApi.detail({ connectionId, path })
    loading.value = false
    if (!result.ok) {
      failure.value = result.message
      return
    }
    detail.value = result.data
  }

  return { connectionId, path, detail, loading, failure, load }
}
