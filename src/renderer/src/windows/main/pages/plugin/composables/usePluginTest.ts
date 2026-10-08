/**
 * 插件测试面板状态：按四个方法逐个试跑，并把资产按当前下载设置标注「会不会下载」。
 *
 * 契约：测试只读，不落盘、不改插件状态；失败只提示，不抛出。
 */
import { computed, ref, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { MessagePlugin } from 'tdesign-vue-next'
import { pluginApi } from '@/api'
import { useSettingDownloadStore } from '@/windows/main/store'
import type {
  PluginAsset,
  PluginMovieCandidate,
  PluginMovieDetail,
  PluginSummary
} from '@common/types/plugin'
import { toAssetRows } from '../pluginUtils'

export type PluginTestTask = 'search' | 'detail' | 'covers' | 'extras' | ''

export function usePluginTest(active: Ref<PluginSummary | null>) {
  const { setting } = storeToRefs(useSettingDownloadStore())
  const keyword = ref('')
  const movieId = ref('')
  const busy = ref<PluginTestTask>('')
  const candidates = ref<PluginMovieCandidate[]>([])
  const detail = ref<PluginMovieDetail | null>(null)
  const covers = ref<PluginAsset[]>([])
  const extras = ref<PluginAsset[]>([])

  const assetRows = computed(() =>
    toAssetRows([...covers.value, ...extras.value], setting.value)
  )

  const willDownloadCount = computed(
    () => assetRows.value.filter((row) => row.willDownload).length
  )

  function requirePlugin(): PluginSummary | null {
    if (!active.value) {
      MessagePlugin.warning('请先选择一个插件')
      return null
    }
    return active.value
  }

  function reset(): void {
    candidates.value = []
    detail.value = null
    covers.value = []
    extras.value = []
  }

  async function runSearch(): Promise<void> {
    const plugin = requirePlugin()
    if (!plugin) return
    if (keyword.value.trim().length === 0) {
      MessagePlugin.warning('请先填写搜索关键字或番号')
      return
    }
    busy.value = 'search'
    const result = await pluginApi.search(plugin.id, keyword.value.trim())
    busy.value = ''
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return
    }
    candidates.value = result.data
    MessagePlugin.success(`搜索到 ${result.data.length} 条候选`)
  }

  async function runDetail(): Promise<void> {
    const plugin = requirePlugin()
    if (!plugin) return
    if (movieId.value.trim().length === 0) {
      MessagePlugin.warning('请先填写影片 ID')
      return
    }
    busy.value = 'detail'
    const result = await pluginApi.detail(plugin.id, movieId.value.trim())
    busy.value = ''
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return
    }
    detail.value = result.data
  }

  async function runAssets(task: 'covers' | 'extras'): Promise<void> {
    const plugin = requirePlugin()
    if (!plugin) return
    if (movieId.value.trim().length === 0) {
      MessagePlugin.warning('请先填写影片 ID')
      return
    }
    busy.value = task
    const result =
      task === 'covers'
        ? await pluginApi.covers(plugin.id, movieId.value.trim())
        : await pluginApi.extras(plugin.id, movieId.value.trim())
    busy.value = ''
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return
    }
    if (task === 'covers') covers.value = result.data
    else extras.value = result.data
  }

  /** 点候选即回填 ID 并拉详情，符合「搜索 → 详情」的常规动线 */
  async function pickCandidate(candidate: PluginMovieCandidate): Promise<void> {
    movieId.value = candidate.id
    await runDetail()
  }

  return {
    keyword,
    movieId,
    busy,
    candidates,
    detail,
    covers,
    extras,
    assetRows,
    willDownloadCount,
    reset,
    runSearch,
    runDetail,
    runAssets,
    pickCandidate
  }
}
