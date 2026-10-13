/**
 * 播放窗口右侧栏的取数：这一部影片的详情 + 这一集是哪一集 + 要不要遮罩。
 *
 * 契约：
 * - 只认主进程给的结果：`itemId` 由播放窗口的装载结果（`player:load` / `player:switch`）决定，不读路由；
 * - 侧栏比详情页**轻**：不搬详情页那套「展示口径」（封面块 / 剧照墙 / 信息格），
 *   只折算封面、标题与几项关键元信息，避免播放窗口被详情页的模块拖住；
 * - NSFW 判定与详情页同一套规则（以总开关为前提，命中所属资料库的 nsfwProtection），
 *   用的是共享的 `useNsfwProtection`；
 * - 换集不在这里落状态：`select` 只改本地高亮，真正的换集由窗口层重新 `open`（主进程是权威）。
 */
import { computed, ref, type Ref } from 'vue'
import { mediaApi } from '@/api'
import { useEpisodeSelection } from '@/hooks/UseEpisodeSelection'
import { useNsfwProtection } from '@/hooks/UseNsfwProtection'
import { formatDuration, formatSize, formatTime } from '@/utils/format'
import type { MediaDetailResult, MediaEpisodeRef, MediaSeasonRef } from '@common/types/media'

/** 侧栏「关键元信息」的一行 */
export interface PlayFact {
  label: string
  value: string
}

export interface PlaySidebar {
  detail: Ref<MediaDetailResult | null>
  loading: Ref<boolean>
  failure: Ref<string>
  /** 标题栏与侧栏共用：优先刮削标题，没有就回落文件名 */
  title: Ref<string>
  protect: Ref<boolean>
  poster: Ref<string>
  facts: Ref<PlayFact[]>
  seasons: Ref<MediaSeasonRef[]>
  activeId: Ref<string>
  activeEpisode: Ref<MediaEpisodeRef | null>
  /** 装载某一部的详情 */
  load: (itemId: string) => Promise<void>
  /** 用户点了某一集：本地先高亮，换集命令由调用方发 */
  select: (episodeId: string) => void
}

export function usePlaySidebar(): PlaySidebar {
  const detail = ref<MediaDetailResult | null>(null)
  const loading = ref(false)
  const failure = ref('')
  const { seasons, activeId, activeEpisode, select } = useEpisodeSelection(detail)

  /** 最终遮罩口径：总开关为前提，库级 nsfwProtection 命中才遮 */
  const { protect } = useNsfwProtection(() => detail.value?.item.nsfwProtected === true)

  const title = computed(() => {
    const item = detail.value?.item
    if (!item) return 'vault-scrape'
    return item.title.length > 0 ? item.title : item.name
  })

  const poster = computed(() => activeEpisode.value?.coverUrl || detail.value?.item.coverUrl || '')

  const facts = computed<PlayFact[]>(() => {
    const item = detail.value?.item
    if (!item) return []
    const meta = detail.value?.meta ?? null
    const cells: PlayFact[] = []
    if (item.num.length > 0) cells.push({ label: '番号', value: item.num })
    if (meta && meta.releaseDate.length > 0) cells.push({ label: '首播', value: meta.releaseDate })
    if (meta && meta.duration > 0) cells.push({ label: '时长', value: formatDuration(meta.duration) })
    if (item.seasonCount > 0 || item.episodeCount > 0) {
      cells.push({ label: '集数', value: `${item.seasonCount} 季 · ${item.episodeCount} 集` })
    }
    cells.push({ label: '体积', value: formatSize(item.size) })
    if (item.libraryName.length > 0) cells.push({ label: '资料库', value: item.libraryName })
    if (item.dateAdded > 0) cells.push({ label: '添加于', value: formatTime(item.dateAdded) })
    return cells
  })

  async function load(itemId: string): Promise<void> {
    if (itemId.length === 0) {
      detail.value = null
      failure.value = ''
      return
    }
    loading.value = true
    failure.value = ''
    const result = await mediaApi.detail({ itemId })
    loading.value = false
    if (!result.ok) {
      failure.value = result.message
      return
    }
    detail.value = result.data
  }

  return { detail, loading, failure, title, protect, poster, facts, seasons, activeId, activeEpisode, load, select }
}
