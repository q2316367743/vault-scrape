<script setup lang="ts">
/**
 * 播放器：artplayer 的 Vue 外壳。
 *
 * 契约：
 * - `url` 变化（换片 / 重新读取）时销毁重建，避免上一部影片的缓冲与错误残留；
 * - 主题色从 tdesign token 读（`--td-brand-color`），不写死品牌色；
 * - NSFW 保护未解除时盖一层不透明遮罩并挡住播放器交互，点击后解除并起播；
 * - 封装 / 编码放不了时只弹 artplayer 自带提示，不抛异常（本版本不做转码）。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Artplayer from 'artplayer'
import { artplayerI18n } from '../mediaPlayerI18n'

const props = withDefaults(
  defineProps<{
    /** `storage://` 播放地址，由主进程用资源 ID 构造 */
    url: string
    /** 封面地址（`storage://`），空串表示没有封面 */
    poster?: string
    /** NSFW 保护是否生效 */
    protect?: boolean
  }>(),
  { poster: '', protect: false }
)

const container = ref<HTMLDivElement | null>(null)
/** 保护未解除时盖遮罩；进入页面时若无需保护则直接可见 */
const revealed = ref(!props.protect)
let art: Artplayer | null = null

/** 主题色跟随 tdesign 品牌色；读不到时回落到 tdesign 默认蓝 */
function themeColor(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--td-brand-color')
  return value.trim() || '#0052d9'
}

function destroy(): void {
  art?.destroy()
  art = null
}

function create(): void {
  destroy()
  const el = container.value
  if (!el) return
  const player = new Artplayer({
    container: el,
    url: props.url,
    poster: props.poster,
    lang: 'zh-cn',
    i18n: artplayerI18n,
    theme: themeColor(),
    volume: 0.8,
    autoplay: false,
    autoSize: false,
    playbackRate: true,
    aspectRatio: true,
    screenshot: true,
    setting: true,
    hotkey: true,
    pip: true,
    fullscreen: true,
    fullscreenWeb: true,
    miniProgressBar: true
  })
  player.on('video:error', () => {
    player.notice.show = '这个视频的封装或编码放不了，建议用本机播放器打开'
  })
  art = player
}

/** 解除保护遮罩并起播 */
function reveal(): void {
  revealed.value = true
  void art?.play()
}

onMounted(create)
onBeforeUnmount(destroy)
watch(() => props.url, create)
</script>

<template>
  <div class="media-player">
    <div ref="container" class="player-container"></div>
    <div v-if="!revealed" class="player-guard">
      <t-button theme="primary" variant="outline" @click="reveal">内容已隐藏，点击播放</t-button>
    </div>
  </div>
</template>

<style scoped lang="less">
.media-player {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-medium);
  background-color: var(--td-bg-color-container);
}

.player-container {
  width: 100%;
  height: 100%;
}

.player-guard {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--td-bg-color-container);
}
</style>
