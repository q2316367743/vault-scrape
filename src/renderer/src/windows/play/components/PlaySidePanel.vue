<template>
  <aside class="play-side">
    <div class="side-scroll">
      <div class="side-hero">
        <sensitive-image
          class="side-cover"
          :src="poster"
          :protect="protect"
          :alt="title"
          width="100%"
          height="100%"
        />
      </div>

      <h2 class="side-title" :title="title">{{ title }}</h2>

      <t-loading v-if="loading" class="side-loading" size="small" text="读取影片详情…" />

      <t-alert v-if="failure.length > 0" class="side-alert" theme="error" :message="failure" />

      <dl v-if="facts.length > 0" class="side-facts">
        <div v-for="fact in facts" :key="fact.label" class="fact-row">
          <dt class="fact-label">{{ fact.label }}</dt>
          <dd class="fact-value" :title="fact.value">{{ fact.value }}</dd>
        </div>
      </dl>

      <!-- 选集区与详情页共用同一个组件（它自带「选集」标题，区块标题样式由这里给） -->
      <media-episode-list
        class="side-episodes"
        :seasons="seasons"
        :active-id="activeId"
        @select="emit('select', $event)"
      />
    </div>
  </aside>
</template>

<script setup lang="ts">
/**
 * 播放窗口右侧栏：封面 + 标题 + 关键元信息 + 选集，精简体量（对齐腾讯视频 / 爱奇艺的播放入口）。
 *
 * 契约：
 * - 宽度固定 360px（`PLAY_LAYOUT.sidebarWidth`），与 `playerStageRect` 算出的视频区互补，
 *   **改宽度必须同时改 `src/common/types/player/layout.ts`**；
 * - 数据全部由 `usePlaySidebar` 取好传进来，本组件不发请求、不读设置；
 * - NSFW：只遮封面（`SensitiveImage` 的 `protect`）。画面本身不遮——Windows 嵌入模式下
 *   mpv 是原生子窗口，网页遮罩盖不住它；
 * - 选集点选只 `emit('select', itemId)`，切集由窗口层发 `playerApi.open()`。
 */
import type { MediaSeasonRef } from '@common/types/media'
import MediaEpisodeList from '@/components/media/MediaEpisodeList.vue'
import SensitiveImage from '@/components/SensitiveImage.vue'

defineProps<{
  /** 影片 / 剧集标题（没有详情时是应用名） */
  title: string
  /** 封面地址，空串时 `SensitiveImage` 不渲染占位 */
  poster: string
  /** 是否处于 NSFW 保护中 */
  protect: boolean
  /** 关键元信息（已折好序） */
  facts: { label: string; value: string }[]
  /** 剧集才有的季列表 */
  seasons: MediaSeasonRef[]
  /** 当前播放的集（`MediaEpisodeRef.itemId`） */
  activeId: string
  /** 详情读取中 */
  loading: boolean
  /** 详情读取失败原因 */
  failure: string
}>()

const emit = defineEmits<{ select: [itemId: string] }>()
</script>

<style scoped lang="less">
.play-side {
  display: flex;
  flex: none;
  width: 360px;
  min-height: 0;
  overflow: hidden;
  background-color: var(--td-bg-color-container);
}

.side-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-l);
}

.side-hero {
  aspect-ratio: 16 / 9;
  margin-bottom: var(--td-comp-margin-m);
}

.side-cover {
  width: 100%;
  height: 100%;
}

.side-title {
  margin: 0 0 var(--td-comp-margin-s);
  overflow: hidden;
  font-size: var(--td-font-size-title-medium);
  font-weight: 600;
  line-height: 1.5;
  color: var(--td-text-color-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.side-loading {
  margin-bottom: var(--td-comp-margin-s);
}

.side-alert {
  margin-bottom: var(--td-comp-margin-s);
}

.side-facts {
  margin: 0 0 var(--td-comp-margin-m);
}

.fact-row {
  display: flex;
  align-items: baseline;
  gap: var(--td-comp-margin-s);
  padding: var(--td-comp-paddingTB-xxs) 0;
}

.fact-label {
  flex: none;
  width: 56px;
  font-size: var(--td-font-size-body-small);
  color: var(--td-text-color-placeholder);
}

.fact-value {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: var(--td-font-size-body-small);
  color: var(--td-text-color-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 选集区与详情页共用组件：内部类名靠 :deep 进去补样式 */
.side-episodes :deep(.episode-head) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-s);
}

.side-episodes :deep(.section-title) {
  margin: 0;
  font-size: var(--td-font-size-title-small);
  font-weight: 600;
  color: var(--td-text-color-primary);
}

.side-episodes :deep(.episode-buttons) {
  display: flex;
  flex-wrap: wrap;
  gap: var(--td-comp-margin-s);
  margin-top: var(--td-comp-margin-s);
}

.side-episodes :deep(.episode-current) {
  display: flex;
  flex-direction: column;
  gap: var(--td-comp-margin-xxs);
  margin-top: var(--td-comp-margin-s);
}

.side-episodes :deep(.episode-name) {
  font-size: var(--td-font-size-body-medium);
  font-weight: 600;
  color: var(--td-text-color-primary);
}

.side-episodes :deep(.episode-note) {
  font-size: var(--td-font-size-body-small);
  color: var(--td-text-color-placeholder);
}

.side-episodes :deep(.episode-plot) {
  margin: 0;
  font-size: var(--td-font-size-body-small);
  line-height: 1.6;
  color: var(--td-text-color-secondary);
}
</style>
