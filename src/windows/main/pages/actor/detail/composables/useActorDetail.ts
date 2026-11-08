/**
 * 演员详情取数：从路由 query 读 `actorId`，向主进程要「资料 + 全部出演作品」。
 *
 * 契约：
 * - 参数缺失（手改地址栏、旧书签）时只写中文 failure，不发请求、不抛异常；
 * - `load()` 可重复调用：重试时保留上一次的数据，只清错误提示；
 * - 出演作品由主进程按演员关联反查并排序，渲染层不再取第二遍。
 */
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { actorApi } from '@/api'
import type { ActorDetailResult } from '@common/types/actor'

export function useActorDetail() {
  const route = useRoute()
  const actorId = typeof route.query.actorId === 'string' ? route.query.actorId : ''

  const detail = ref<ActorDetailResult | null>(null)
  const loading = ref(false)
  const failure = ref('')

  async function load(): Promise<void> {
    if (actorId.length === 0) {
      failure.value = '地址里缺少演员参数，请从演员列表点进来'
      return
    }
    loading.value = true
    failure.value = ''
    const result = await actorApi.detail({ actorId })
    loading.value = false
    if (!result.ok) {
      failure.value = result.message
      return
    }
    detail.value = result.data
  }

  return { actorId, detail, loading, failure, load }
}
