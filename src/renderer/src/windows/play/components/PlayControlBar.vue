<template>
  <div class="play-controls">
    <t-tooltip :content="playing ? '暂停（空格）' : '播放（空格）'" placement="top">
      <t-button
        class="ctrl-button"
        variant="text"
        shape="circle"
        :aria-label="playing ? '暂停' : '播放'"
        @click="onToggle"
      >
        <pause-icon v-if="playing" />
        <play-icon v-else />
      </t-button>
    </t-tooltip>

    <span class="ctrl-clock">{{ formatClock(state.position) }}</span>

    <t-slider
      class="ctrl-progress"
      :model-value="progress"
      :min="0"
      :max="max"
      :step="1"
      :disabled="!seekable"
      @change="onSeek"
    />

    <span class="ctrl-clock">{{ formatClock(state.duration) }}</span>

    <t-popup trigger="hover" placement="top">
      <t-button
        class="ctrl-button"
        variant="text"
        shape="circle"
        :aria-label="muted ? '取消静音' : '静音'"
        @click="onToggleMute"
      >
        <sound-mute-icon v-if="muted" />
        <sound-icon v-else />
      </t-button>
      <template #content>
        <div class="ctrl-volume">
          <t-slider :model-value="state.volume" :min="0" :max="1" :step="0.05" @change="onVolume" />
        </div>
      </template>
    </t-popup>

    <t-dropdown :options="rateOptions" trigger="click" placement="top" @click="onRate">
      <t-button class="ctrl-button ctrl-rate" variant="text" aria-label="播放速度">
        {{ rateLabel }}
      </t-button>
    </t-dropdown>

    <t-tooltip content="全屏（Esc 退出）" placement="top">
      <t-button class="ctrl-button" variant="text" shape="circle" aria-label="全屏" @click="onFullscreen">
        <fullscreen-icon />
      </t-button>
    </t-tooltip>
  </div>
</template>

<script setup lang="ts">
/**
 * 播放控制条：进度 / 播放暂停 / 音量 / 倍速 / 全屏。
 *
 * 契约：
 * - 高度固定 72px（`PLAY_LAYOUT.controlBarHeight`），**单独占一行，不能浮在视频区上**：
 *   Windows 下 mpv 的宿主窗口是原生子窗口，永远压在网页内容之上，浮层会被它整块盖住；
 * - 自己不做播放控制，一切动作都 `emit('command', …)`，由 `usePlaySession.apply` 分流
 *   （mpv 走主进程 IPC，内置后端在渲染层本地执行）；
 * - 全屏时整条不渲染（`playerStageRect` 全屏会把视频区铺满整个窗口），退出全屏靠 Esc / 双击画面；
 * - 破坏性判断（能不能拖进度、显示静音图标）都在这里做，`state` 只读。
 */
import { computed, h } from 'vue'
import {
  FullscreenIcon,
  PauseIcon,
  PlayIcon,
  SoundIcon,
  SoundMuteIcon
} from 'tdesign-icons-vue-next'
import type { DropdownOption } from 'tdesign-vue-next'
import type { PlayerCommand, PlayerState } from '@common/types/player'
import { formatClock } from '@/utils/format'

const props = defineProps<{
  /** 主进程推来的播放状态（内置后端由 `usePlaySession` 折算成同一份） */
  state: PlayerState
}>()

const emit = defineEmits<{ command: [PlayerCommand] }>()

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

const playing = computed(() => !props.state.paused)
const seekable = computed(() => props.state.duration > 0)
/** 时长还没读到（或读到 0）时不把滑块顶到 1：显示 0 进度 */
const max = computed(() => Math.max(props.state.duration, 1))
const progress = computed(() => Math.min(Math.max(props.state.position, 0), props.state.duration))
const muted = computed(() => props.state.muted || props.state.volume <= 0)
const rateLabel = computed(() => `${props.state.rate}×`)

const rateOptions = computed<DropdownOption[]>(() =>
  RATES.map((rate) => ({
    content: `${rate}×`,
    value: rate,
    prefixIcon: props.state.rate === rate ? () => h(PlayIcon) : undefined
  }))
)

function onToggle(): void {
  emit('command', { kind: 'toggle' })
}

function onSeek(value: number): void {
  emit('command', { kind: 'seek', position: value })
}

function onVolume(value: number): void {
  emit('command', { kind: 'volume', volume: value })
}

function onToggleMute(): void {
  emit('command', { kind: 'mute', muted: !props.state.muted })
}

function onRate(option: DropdownOption): void {
  if (typeof option.value !== 'number') return
  emit('command', { kind: 'rate', rate: option.value })
}

function onFullscreen(): void {
  emit('command', { kind: 'fullscreen' })
}
</script>

<style scoped lang="less">
.play-controls {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--td-comp-margin-s);
  box-sizing: border-box;
  height: 72px;
  padding: 0 var(--td-comp-paddingLR-l);
  background-color: var(--td-bg-color-container);
}

.ctrl-button {
  flex: none;
  width: 32px;
  height: 32px;
  padding: 0;
  font-size: var(--td-font-size-title-medium);
}

.ctrl-rate {
  width: auto;
  min-width: 44px;
  padding: 0 var(--td-comp-paddingLR-xs);
  font-size: var(--td-font-size-body-medium);
}

.ctrl-clock {
  flex: none;
  min-width: 44px;
  font-size: var(--td-font-size-body-small);
  color: var(--td-text-color-secondary);
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.ctrl-progress {
  flex: 1;
  min-width: 0;
}

.ctrl-volume {
  width: 96px;
  padding: var(--td-comp-paddingTB-xs) var(--td-comp-paddingLR-s);
}
</style>
