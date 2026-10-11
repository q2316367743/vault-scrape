<template>
  <section v-if="seasons.length > 0" class="detail-section episode-section">
    <div class="episode-head">
      <h4 class="section-title">选集</h4>
      <t-select
        v-if="seasons.length > 1"
        class="season-select"
        size="small"
        :model-value="seasonNumber"
        :options="seasonOptions"
        @change="onSeasonChange"
      />
    </div>

    <div class="episode-buttons">
      <t-button
        v-for="episode in currentEpisodes"
        :key="episode.itemId"
        :theme="episode.itemId === activeId ? 'primary' : 'default'"
        :variant="episode.itemId === activeId ? 'base' : 'outline'"
        size="small"
        @click="emit('select', episode.itemId)"
      >
        第 {{ episode.episodeNumber }} 集
      </t-button>
    </div>

    <div v-if="active" class="episode-current">
      <span class="episode-name">{{ active.title }}</span>
      <span v-if="note.length > 0" class="episode-note">{{ note }}</span>
      <p v-if="active.overview.length > 0" class="episode-plot">{{ active.overview }}</p>
    </div>
  </section>
</template>
<script setup lang="ts">
/**
 * 详情页的选集区：季选择器 + 集按钮 + 当前集的标题 / 时长 / 简介。
 *
 * 契约：
 * - `seasons` 由主进程给（只含已经有媒体源、能播的集），影片是空数组 —— 空数组时整块不渲染；
 * - 自己不持有「播哪一集」的真相：只 `emit('select')`，高亮看 `activeId`，
 *   页面把它交给 `useEpisodeSelection`（默认第一集、重读后回落第一集）；
 * - 季选择器只影响**这一屏显示哪一季的集按钮**，不改变选中集；
 *   选中的集换季（含重新读取后回落）时选择器会自己拨过去，避免按钮列表里找不到高亮项；
 * - 只读展示：不取数、不写数据、不碰播放器。
 */
import { computed, ref, watch } from 'vue'
import type { MediaSeasonRef } from '@common/types/media'
import { formatDuration, formatSize } from '@/utils/format'

const props = defineProps<{
  /** 主进程给的季与集（只含能播的集）；空数组表示这不是剧集或一集都不可播 */
  seasons: MediaSeasonRef[]
  /** 当前选中的集 ID，用来高亮 */
  activeId: string
}>()

const emit = defineEmits<{ select: [itemId: string] }>()

/** 这一屏显示哪一季的集；只影响列表，不代表选中 */
const seasonNumber = ref(props.seasons[0]?.seasonNumber ?? 1)
const seasonOptions = computed(() =>
  props.seasons.map((season) => ({
    value: season.seasonNumber,
    label: `第 ${season.seasonNumber} 季`
  }))
)
const currentEpisodes = computed(
  () => props.seasons.find((season) => season.seasonNumber === seasonNumber.value)?.episodes ?? []
)
const active = computed(
  () => currentEpisodes.value.find((episode) => episode.itemId === props.activeId) ?? null
)
const note = computed(() => {
  const episode = active.value
  if (!episode) return ''
  return [
    episode.runtimeMinutes > 0 ? formatDuration(episode.runtimeMinutes) : '',
    episode.premiereDate,
    formatSize(episode.size)
  ]
    .filter((part) => part.length > 0)
    .join(' · ')
})

/** 选中的集换季时把选择器拨过去：高亮项必须出现在当前这一屏里 */
watch(
  () => props.activeId,
  () => {
    const season = props.seasons.find((item) =>
      item.episodes.some((episode) => episode.itemId === props.activeId)
    )
    if (season) seasonNumber.value = season.seasonNumber
  }
)

/** 重新读取后季列表变了（季数变少 / 季号变了）：把选择器收回一个仍然存在的季 */
watch(
  () => props.seasons.map((season) => season.seasonNumber).join(','),
  () => {
    const exists = props.seasons.some((season) => season.seasonNumber === seasonNumber.value)
    if (!exists) seasonNumber.value = props.seasons[0]?.seasonNumber ?? 1
  }
)

function onSeasonChange(value: unknown): void {
  const next = Number(value)
  if (Number.isFinite(next)) seasonNumber.value = next
}
</script>

<style scoped lang="less">
.episode-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.season-select {
  width: 132px;
}

.episode-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.episode-current {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 14px;
}

.episode-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--td-text-color-primary);
  word-break: break-word;
}

.episode-note {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.episode-plot {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--td-text-color-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
