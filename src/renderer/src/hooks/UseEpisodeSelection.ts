/**
 * 剧集的选集状态：播哪一集由这里决定（影片详情页与播放窗口侧栏共用）。
 *
 * 契约：
 * - 只认主进程放进 `seasons` 的集（**已经有媒体源、能播的集**才会出现），影片的 `seasons` 是空数组；
 * - 没手选过、或选中的那集在重新读取后已经不存在时，一律回落到第一集，
 *   所以「重新读取」不需要清状态，换条目也不会停在上一部的集上；
 * - 播放地址与封面：选集优先，没有集时回落条目自己的（影片就是这条路径）；
 * - 这里只做选择与折算：取数在调用方（详情页在 `useMediaDetail`），播放交给主进程的播放会话。
 */
import { computed, ref } from 'vue'
import type { Ref } from 'vue'
import type { MediaDetailResult, MediaEpisodeRef } from '@common/types/media'

export function useEpisodeSelection(detail: Ref<MediaDetailResult | null>) {
  /** 手动选中的集 ID；空串表示「还没选」，由第一集兜底 */
  const activeId = ref('')
  const seasons = computed(() => detail.value?.seasons ?? [])
  const episodes = computed(() => seasons.value.flatMap((season) => season.episodes))
  const activeEpisode = computed<MediaEpisodeRef | null>(
    () =>
      episodes.value.find((episode) => episode.itemId === activeId.value) ??
      episodes.value[0] ??
      null
  )
  /** 播放地址：选中集的源地址；影片没有集时用条目自己的 */
  const playUrl = computed(() => activeEpisode.value?.playUrl ?? detail.value?.item.playUrl ?? '')
  /** 播放器海报：选中集的封面优先，没有就用剧集封面 */
  const poster = computed(() => activeEpisode.value?.coverUrl ?? detail.value?.item.coverUrl ?? '')

  function select(itemId: string): void {
    activeId.value = itemId
  }

  return {
    seasons,
    activeId: computed(() => activeEpisode.value?.itemId ?? ''),
    activeEpisode,
    playUrl,
    poster,
    select
  }
}
