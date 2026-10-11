/**
 * 演员列表取数。
 *
 * 契约：
 * - 查询条件（关键词 / 标签 / 排序 / 每页条数 / 页码）都由本 composable 持有，页面只读不写；
 * - 条件变化一律先回第一页再请求（`search()`），翻页只调 `load()`；
 * - 失败只写中文 `failure`，保留上一次的列表，页面给重试入口。
 */
import { ref } from 'vue'
import { actorApi } from '@/api'
import { ACTOR_LIST_PAGE_SIZE, type ActorSort, type ActorSummary } from '@common/types/actor'

export function useActorList() {
  const list = ref<ActorSummary[]>([])
  const tags = ref<string[]>([])
  const total = ref(0)
  const keyword = ref('')
  const tag = ref('')
  const sort = ref<ActorSort>('updated')
  const limit = ref(ACTOR_LIST_PAGE_SIZE)
  const page = ref(1)
  const loading = ref(false)
  const failure = ref('')

  async function load(): Promise<void> {
    loading.value = true
    failure.value = ''
    const result = await actorApi.list({
      keyword: keyword.value.trim(),
      tag: tag.value,
      sort: sort.value,
      offset: (page.value - 1) * limit.value,
      limit: limit.value
    })
    loading.value = false
    if (!result.ok) {
      failure.value = result.message
      return
    }
    list.value = result.data.items
    total.value = result.data.total
    tags.value = result.data.tags
  }

  /** 筛选条件变化：回到第一页再查 */
  async function search(): Promise<void> {
    page.value = 1
    await load()
  }

  return {
    list,
    tags,
    total,
    keyword,
    tag,
    sort,
    limit,
    page,
    loading,
    failure,
    load,
    search
  }
}
