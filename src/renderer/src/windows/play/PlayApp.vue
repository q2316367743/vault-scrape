<template>
  <div class="play-root" :class="{ 'is-hole': layout.transparentStage }">
    <app-title-bar v-if="!fullscreen" :title="sideTitle" />

    <div class="play-body">
      <div class="play-video" :class="{ 'is-overlay': overlayControls }">
        <play-stage
          :state="state"
          :notice="notice"
          :transparent="layout.transparentStage"
          @stage="attachStage"
          @command="apply"
        />
        <play-control-bar v-if="showControls" :state="state" :overlay="overlayControls" @command="apply" />
      </div>

      <play-side-panel
        v-if="!fullscreen"
        :title="sideTitle"
        :poster="poster"
        :protect="protect"
        :facts="facts"
        :seasons="seasons"
        :active-id="activeId"
        :loading="loading"
        :failure="failure"
        @select="onSelect"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 播放窗口：左侧画面 + 右侧影片详情侧栏（腾讯视频 / 爱奇艺式的播放入口）。
 *
 * 契约（与主进程的几何约定，逐像素相关，改这里要同步 `src/common/types/player/layout.ts`）：
 * - 标题栏 40px、右侧栏 360px、控制条 72px；除这三块外**不放任何 gap / padding / 边框**，
 *   Windows 下 mpv 的宿主窗口就贴在这一块视频区上；
 * - 排法由主进程推来的 `layout` 决定，不在这里各平台分支：
 *   `controlBarRow` 假 = 控制条悬浮在画面底部、视频区不扣那 72px（macOS 的 mpv 独立窗口）；
 *   `transparentStage` 真 = 视频区透明挖洞给 mpv，标题栏得自己补底色；
 * - 控制条只在 mpv 后端渲染：内置 artplayer 自带一条控制条，再来一条就是「多出一行」；
 * - 全屏时只留视频区（标题栏 / 控制条 / 侧栏都不渲染），退出靠 Esc 或双击画面；
 * - 侧栏数据由 `usePlaySidebar` 取，播放状态由 `usePlaySession` 管，键盘在 `useKeyboard`；
 * - 点某一集：先把侧栏选中拨过去（立刻高亮），再 `playerApi.open()` 让主进程换片——
 *   窗口已存在时主进程会推 `switch` 事件回来，`session` 自己切后端，本组件靠 `result` 变更刷新侧栏。
 */
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { playerApi } from '@/api'
import AppTitleBar from '@/components/app/AppTitleBar.vue'
import PlayControlBar from './components/PlayControlBar.vue'
import PlaySidePanel from './components/PlaySidePanel.vue'
import PlayStage from './components/PlayStage.vue'
import { useKeyboard } from './composables/useKeyboard'
import { usePlaySession } from './composables/usePlaySession'
import { usePlaySidebar } from './composables/usePlaySidebar'

const session = usePlaySession()
const { state, result, layout, fullscreen, notice, attachStage, start, apply, dispose } = session

const { loading, failure, title: sideTitle, protect, poster, facts, seasons, activeId, load, select } =
  usePlaySidebar()

/** 控制条悬浮在画面上（否则独占视频区下方一行） */
const overlayControls = computed(() => !layout.value.controlBarRow)

/** 只有 mpv 后端需要这条自绘控制条；内置播放器用 artplayer 自己的 */
const showControls = computed(() => !fullscreen.value && state.value.backend === 'mpv')

useKeyboard(session)

// 装载结果（首次 load / 主进程 switch 推来）变了就重新取详情，并把侧栏选中拨到这一集
watch(
  () => result.value?.itemId ?? '',
  (itemId) => {
    void load(itemId)
  },
  { immediate: true }
)

watch(
  () => result.value?.episodeId ?? '',
  (episodeId) => {
    if (episodeId.length > 0) select(episodeId)
  },
  { immediate: true }
)

onMounted(() => {
  void start()
})

onBeforeUnmount(dispose)

function onSelect(episodeId: string): void {
  const itemId = result.value?.itemId ?? ''
  if (itemId.length === 0) return
  select(episodeId)
  void playerApi.open({ itemId, episodeId })
}
</script>

<style scoped lang="less">
.play-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-height: 0;
  overflow: hidden;
  background-color: var(--td-bg-color-page);
}

/* 挖洞模式（当前不启用：macOS 已停用 mpv，`transparentStage` 恒为 false；字段保留是为了将来恢复该方案）
   ——标题栏这一圈得自己补底色 */
.play-root.is-hole {
  background-color: transparent;
}

.play-root.is-hole :deep(.title-bar) {
  background-color: var(--td-bg-color-page);
}

.play-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.play-video {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

/* 控制条悬浮时的定位参照；独占一行时不需要（省一层 position） */
.play-video.is-overlay {
  position: relative;
}
</style>
