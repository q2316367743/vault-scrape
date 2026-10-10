<script setup lang="ts">
/**
 * 播放器：artplayer 的 Vue 外壳（影视墙详情页与存储页预览共用）。
 *
 * 契约：
 * - `url` 变化（换片 / 换文件 / 重新读取）时销毁重建，避免上一部影片的缓冲与错误残留；
 * - 主题色从 tdesign token 读（`--td-brand-color`），不写死品牌色；
 * - NSFW 保护未解除时盖一层不透明遮罩并挡住播放器交互，点击后解除并起播；
 * - 封装 / 编码放不了或文件读不出来时，不是留一块黑屏：在播放器位置盖一层
 *   「封面（可无）+ 说明文案」，说明文案由调用方传 `fallbackText`（本版本不做转码）；
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Artplayer from 'artplayer'
import { artplayerI18n } from './mediaPlayerI18n'

const props = withDefaults(
  defineProps<{
    /** `storage://` 播放地址（媒体 ID 或存储页预览路径），由主进程解析 */
    url: string
    /** 封面地址（`storage://`），空串表示没有封面 */
    poster?: string
    /** NSFW 保护是否生效 */
    protect?: boolean
    /** 播放失败时的说明文案，由调用方按场景给 */
    fallbackText?: string
  }>(),
  {
    poster: '',
    protect: false,
    fallbackText:
      '视频读不出来：文件可能已被移动或删除，也可能是封装 / 编码放不了；可以先用本机播放器打开这个目录，也可以在影视墙里对资料库重新扫描一次。'
  }
)

const container = ref<HTMLDivElement | null>(null)
/** 保护未解除时盖遮罩；进入页面时若无需保护则直接可见 */
const revealed = ref(!props.protect)
/** 播放器报错（文件不在 / 编码放不了）时改显示封面兜底层 */
const failed = ref(false)
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
  failed.value = false
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
    failed.value = true
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
    <div v-if="failed" class="player-fallback">
      <t-image
        v-if="revealed && poster"
        class="player-fallback-cover"
        :src="poster"
        fit="contain"
        alt="封面"
      />
      <p class="player-fallback-text">{{ fallbackText }}</p>
    </div>
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

/* 播放失败兜底层：铺满播放器位置显示封面，压一层说明文案 */
.player-fallback {
  position: absolute;
  inset: 0;
  background-color: var(--td-bg-color-container);
}

.player-fallback-cover {
  width: 100%;
  height: 100%;
}

.player-fallback-text {
  position: absolute;
  bottom: var(--td-comp-margin-l);
  left: 50%;
  max-width: 80%;
  margin: 0;
  padding: var(--td-comp-paddingTB-xs) var(--td-comp-paddingLR-s);
  transform: translateX(-50%);
  border-radius: var(--td-radius-default);
  background-color: var(--td-mask-active);
  color: var(--td-text-color-anti);
  font: var(--td-font-body-small);
  text-align: center;
}
</style>
