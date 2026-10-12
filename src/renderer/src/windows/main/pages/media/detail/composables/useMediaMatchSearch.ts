/**
 * 手动匹配的搜索状态：把「输入框 → 候选列表」这一段独立出来。
 *
 * 契约：
 * 1. 可选插件 = 条目所属资料库配置的刮削器 ∩ 当前可用插件（与批量任务同一口径），
 *    一个都没有时 `blocked` 为真，界面只提示去资料库设置里配置；
 * 2. 输入语义按条目是否受保护区分 —— 受保护（NSFW）按番号走 `search`；
 *    不受保护时，**纯数字按 TMDB ID 走 `detail` 直查**（`search` 不会把数字当 ID），
 *    其余按关键字走 `search`；
 * 3. 只读：搜索阶段不落盘、不改插件状态；应用由内容组件调 `scrapeApi.match`。
 */
import { computed, ref } from 'vue'
import { libraryApi, pluginApi } from '@/api'
import { MessageUtil } from '@/utils/modal'
import { COVER_ASSET_KINDS } from '@common/types/plugin'
import type { PluginAsset, PluginMovieCandidate, PluginSummary } from '@common/types/plugin'

/** 列表里的一条候选：带上产出它的插件，应用时需要回传 */
export interface MatchCandidate {
  /** `${pluginId}:${candidate.id}`，跨插件唯一 */
  key: string
  pluginId: string
  pluginName: string
  candidate: PluginMovieCandidate
}

/** 纯数字输入：不受保护时按 TMDB ID 直查，不再当关键字搜 */
const DIGITS = /^\d+$/

function coverOf(assets: PluginAsset[]): string {
  for (const kind of COVER_ASSET_KINDS) {
    const hit = assets.find((asset) => asset.kind === kind && asset.url.length > 0)
    if (hit) return hit.url
  }
  return ''
}

export function useMediaMatchSearch(options: { libraryId: string; nsfwProtected: boolean }) {
  const keyword = ref('')
  const loading = ref(false)
  const searching = ref(false)
  const searched = ref(false)
  const failure = ref('')
  const candidates = ref<MatchCandidate[]>([])
  const plugins = ref<PluginSummary[]>([])
  /** 资料库没有可用刮削器：不给出搜索框，只提示去配置 */
  const blocked = ref(false)

  const placeholder = computed(() =>
    options.nsfwProtected ? '输入番号，例如 ABC-123' : '输入 TMDB ID 或关键字'
  )

  const pluginNames = computed(() => plugins.value.map((plugin) => plugin.name).join('、'))

  /** 读资料库与插件清单，算出这个条目能用哪些刮削器 */
  async function load(): Promise<void> {
    loading.value = true
    failure.value = ''
    blocked.value = false
    try {
      const [libraries, all] = await Promise.all([libraryApi.list(), pluginApi.movie.list()])
      if (!libraries.ok) {
        failure.value = libraries.message
        return
      }
      if (!all.ok) {
        failure.value = all.message
        return
      }
      const library = libraries.data.find((row) => row.id === options.libraryId)
      if (!library) {
        blocked.value = true
        failure.value = '找不到这条影视所属的资料库，请重新扫描资料库后再试'
        return
      }
      const wanted = new Set(library.scrapers)
      plugins.value = all.data.filter(
        (plugin) => wanted.has(plugin.id) && plugin.enabled && plugin.loadError.length === 0
      )
      blocked.value = plugins.value.length === 0
    } finally {
      loading.value = false
    }
  }

  /** 纯数字直查：detail 拿元数据，covers 补封面（detail 本身不带封面） */
  async function searchById(plugin: PluginSummary, id: string): Promise<MatchCandidate | null> {
    const detail = await pluginApi.movie.detail(plugin.id, id)
    if (!detail.ok) return null
    const covers = await pluginApi.movie.covers(plugin.id, detail.data.id)
    const candidate: PluginMovieCandidate = {
      id: detail.data.id,
      title: detail.data.title,
      num: detail.data.num ?? '',
      actors: detail.data.actors ?? [],
      isSeries: (detail.data.episodes?.length ?? 0) > 0,
      episodeCount: detail.data.episodes?.length ?? 0,
      cover: covers.ok ? coverOf(covers.data) : ''
    }
    return { key: `${plugin.id}:${candidate.id}`, pluginId: plugin.id, pluginName: plugin.name, candidate }
  }

  /** 关键字搜索：按顺序问每个刮削器，合并结果 */
  async function searchByKeyword(text: string): Promise<MatchCandidate[]> {
    const found: MatchCandidate[] = []
    for (const plugin of plugins.value) {
      const result = await pluginApi.movie.search(plugin.id, text)
      if (!result.ok) {
        failure.value = `${plugin.name}：${result.message}`
        continue
      }
      for (const candidate of result.data) {
        found.push({
          key: `${plugin.id}:${candidate.id}`,
          pluginId: plugin.id,
          pluginName: plugin.name,
          candidate
        })
      }
    }
    return found
  }

  async function runSearch(): Promise<void> {
    const text = keyword.value.trim()
    if (text.length === 0) {
      MessageUtil.warning('请先填写搜索内容')
      return
    }
    if (plugins.value.length === 0) {
      blocked.value = true
      return
    }
    searching.value = true
    failure.value = ''
    candidates.value = []
    try {
      const direct = !options.nsfwProtected && DIGITS.test(text)
      let found: MatchCandidate[] = []
      if (direct) {
        for (const plugin of plugins.value) {
          const hit = await searchById(plugin, text)
          if (hit) {
            found = [hit]
            break
          }
        }
        if (found.length === 0) failure.value = `没有找到 TMDB ID 为 ${text} 的影视`
      } else {
        found = await searchByKeyword(text)
      }
      const seen = new Set<string>()
      candidates.value = found.filter((row) => {
        if (seen.has(row.key)) return false
        seen.add(row.key)
        return true
      })
      searched.value = true
      if (candidates.value.length === 0 && failure.value.length === 0) {
        MessageUtil.warning('没有搜索到候选，换个关键字再试')
      }
    } finally {
      searching.value = false
    }
  }

  /** 换条目 / 重开弹窗时清空上一轮结果 */
  function reset(): void {
    keyword.value = ''
    candidates.value = []
    searched.value = false
    failure.value = ''
  }

  return {
    keyword,
    loading,
    searching,
    searched,
    failure,
    candidates,
    plugins,
    blocked,
    placeholder,
    pluginNames,
    load,
    runSearch,
    reset
  }
}
