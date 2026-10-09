/**
 * 插件测试面板状态：搜索候选，具体的影片详情交给影片详情抽屉。
 *
 * 契约：测试只读，不落盘、不改插件状态；失败只提示，不抛出。
 */
import { ref, type Ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { pluginApi } from '@/api'
import type { PluginMovieCandidate, PluginSummary } from '@common/types/plugin'

export function usePluginTest(active: Ref<PluginSummary | null>) {
  const keyword = ref('')
  const searching = ref(false)
  const candidates = ref<PluginMovieCandidate[]>([])

  function requirePlugin(): PluginSummary | null {
    if (!active.value) {
      MessagePlugin.warning('请先选择一个插件')
      return null
    }
    return active.value
  }

  function reset(): void {
    candidates.value = []
  }

  async function runSearch(): Promise<void> {
    const plugin = requirePlugin()
    if (!plugin) return
    if (keyword.value.trim().length === 0) {
      MessagePlugin.warning('请先填写搜索关键字或番号')
      return
    }
    searching.value = true
    const result = await pluginApi.search(plugin.id, keyword.value.trim())
    searching.value = false
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return
    }
    candidates.value = result.data
    if (result.data.length > 0) MessagePlugin.success(`搜索到 ${result.data.length} 条候选`)
    else MessagePlugin.warning('没有搜索到候选')
  }

  return { keyword, searching, candidates, reset, runSearch }
}
