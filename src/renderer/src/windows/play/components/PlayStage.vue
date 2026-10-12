<template>
  <div class="play-stage">
    <div ref="box" class="play-stage-canvas" @dblclick="onDblclick"></div>
    <div v-if="waiting" class="play-stage-waiting">
      <t-loading size="small" />
    </div>
    <!-- 说明文案（mpv 起不来 / 没有媒体源）盖在画面上，但不参与布局、不吃点击 -->
    <div v-if="notice.length > 0" class="play-stage-notice">
      <t-alert theme="warning" :message="notice" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 视频区：artplayer / mpv 画面的落点。
 *
 * 契约：
 * - 这一块矩形**必须与 `playerStageRect` 算出来的视频区逐像素一致**（不加 margin / padding / 边框），
 *   Windows 下 mpv 的宿主窗口就贴在这块矩形上，偏一点画面就错位；
 * - 容器元素通过 `stage` 事件交给窗口层（`usePlaySession.attachStage`），artplayer 挂上去；
 * - 双击切全屏；mpv 嵌入时点击其实落在宿主页上（`windows/host/HostApp.vue`），这里的双击只服务内置后端。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { PlayerCommand, PlayerState } from '@common/types/player'

const props = defineProps<{
  state: PlayerState
  /** 需要向用户说明的话（`usePlaySession.notice`） */
  notice: string
}>()

const emit = defineEmits<{
  stage: [HTMLDivElement | null]
  command: [PlayerCommand]
}>()

const box = ref<HTMLDivElement | null>(null)
const waiting = computed(() => props.state.buffering)

function onDblclick(): void {
  emit('command', { kind: 'fullscreen' })
}

onMounted(() => emit('stage', box.value))
onBeforeUnmount(() => emit('stage', null))
</script>

<style scoped lang="less">
.play-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  /* 视频区一律纯黑：letterbox 的底色由画面决定，不跟随主题 */
  background-color: #000;
}

.play-stage-canvas {
  width: 100%;
  height: 100%;
}

.play-stage-waiting {
  position: absolute;
  right: var(--td-comp-margin-l);
  bottom: var(--td-comp-margin-l);
  padding: var(--td-comp-paddingTB-xs) var(--td-comp-paddingLR-xs);
  border-radius: var(--td-radius-default);
  background-color: var(--td-mask-active);
}

.play-stage-notice {
  position: absolute;
  top: var(--td-comp-margin-l);
  left: var(--td-comp-margin-l);
  right: var(--td-comp-margin-l);
  pointer-events: none;
}
</style>
