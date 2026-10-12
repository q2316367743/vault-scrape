<template>
  <header class="title-bar" :class="{ 'is-mac': isMac }">
    <div class="bar-main">
      <slot name="leading"></slot>
      <span class="bar-title" :title="title">{{ title }}</span>
      <slot name="afterTitle"></slot>
      <span class="bar-fill"></span>
      <slot name="trailing"></slot>
    </div>

    <div v-if="!isMac" class="window-buttons">
      <t-button
        class="window-button"
        variant="text"
        aria-label="最小化"
        @click="appWindowApi.minimize()"
      >
        <minus-icon />
      </t-button>
      <t-button
        class="window-button"
        variant="text"
        :aria-label="maximized ? '还原' : '最大化'"
        @click="onToggleMaximize"
      >
        <fullscreen-exit-1-icon v-if="maximized" />
        <fullscreen-1-icon v-else />
      </t-button>
      <t-button
        class="window-button is-close"
        variant="text"
        aria-label="关闭"
        @click="appWindowApi.close()"
      >
        <close-icon />
      </t-button>
    </div>
  </header>
</template>
<script setup lang="ts">
/**
 * 自绘标题栏（主窗口与播放窗口共用）。
 *
 * 契约：
 * - 窗口按钮（最小化 / 最大化 / 关闭）由本组件自绘并**永远操作当前窗口**：主进程按 IPC 事件反查窗口，
 *   所以两个窗口共用同一个组件不会互相误伤；
 * - macOS 保留系统红黄绿灯（`titleBarStyle: 'hidden'`），标题栏为其让出左侧 80px；
 * - 最大化状态无法由渲染层感知，只能订阅主进程推送（窗口创建方要调 `bindWindowState(win)`）；
 * - `leading` / `afterTitle` / `trailing` 三个插槽给调用方放自己的东西：`afterTitle` 紧挨产品名（放「正在播放」这类
 *   跟随标题的状态），`trailing` 在弹性空档之后（放右侧工具）；槽内 tdesign 按钮自动排除在拖动区之外。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import {
  CloseIcon,
  Fullscreen1Icon,
  FullscreenExit1Icon,
  MinusIcon
} from 'tdesign-icons-vue-next'
import { appWindowApi } from '@/api'

withDefaults(
  defineProps<{
    /** 标题栏文字；播放窗口用来显示片名 */
    title?: string
  }>(),
  { title: 'vault-scrape' }
)

/** macOS 保留系统红黄绿灯，其余平台由本组件自绘窗口按钮 */
const isMac = appWindowApi.isMac

/** 最大化状态：系统标题栏已隐藏，只能由主进程的窗口事件驱动 */
const maximized = ref(false)
let disposeMaximized: (() => void) | undefined

function onToggleMaximize(): void {
  void appWindowApi.toggleMaximize().then((value) => {
    maximized.value = value
  })
}

onMounted(() => {
  void appWindowApi.isMaximized().then((value) => {
    maximized.value = value
  })
  disposeMaximized = appWindowApi.onMaximizedChange((value) => {
    maximized.value = value
  })
})

onUnmounted(() => {
  disposeMaximized?.()
})
</script>

<style scoped lang="less">
.title-bar {
  display: flex;
  flex: none;
  align-items: center;
  height: 40px;
  padding-left: 8px;
  -webkit-app-region: drag;
  app-region: drag;
}

// macOS 的红黄绿灯由系统绘制在左上角，标题栏为其让出位置
.title-bar.is-mac {
  padding-left: 80px;
}

.bar-main {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.bar-title {
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: var(--td-text-color-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bar-fill {
  flex: 1;
}

// 标题栏是拖拽区，插槽里的交互元素必须显式排除，否则点击会被窗口拖动吞掉
.title-bar :deep(.t-button) {
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.window-buttons {
  display: flex;

  .window-button {
    width: 46px;
    height: 40px;
    padding: 0;
    border-radius: 0;

    // 关闭键沿用 Windows 11 的红色悬停语义
    &.is-close:hover {
      background: var(--td-error-color);

      :deep(.t-icon) {
        color: var(--td-text-color-anti);
      }
    }
  }
}
</style>
