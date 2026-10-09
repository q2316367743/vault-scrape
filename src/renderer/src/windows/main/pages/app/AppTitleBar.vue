<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import {
  CloseIcon,
  Fullscreen1Icon,
  FullscreenExit1Icon,
  MenuFoldIcon,
  MenuUnfoldIcon,
  MinusIcon
} from 'tdesign-icons-vue-next'
import { appWindowApi } from '@/api'
import { collapsed, toggleCollapsed } from '@/global/AppState'

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

<template>
  <header class="title-bar" :class="{ 'is-mac': isMac }">
    <t-tooltip :content="collapsed ? '展开侧栏' : '收起侧栏'" placement="bottom">
      <t-button
        class="bar-toggle"
        variant="text"
        :aria-label="collapsed ? '展开侧栏' : '收起侧栏'"
        @click="toggleCollapsed"
      >
        <menu-unfold-icon v-if="collapsed" />
        <menu-fold-icon v-else />
      </t-button>
    </t-tooltip>

    <span class="bar-title">vault-scrape</span>

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

<style scoped lang="less">
.title-bar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding-left: 8px;
  -webkit-app-region: drag;
  app-region: drag;
}

// macOS 的红黄绿灯由系统绘制在左上角，标题栏为其让出位置
.title-bar.is-mac {
  padding-left: 80px;
}

.bar-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: var(--td-text-color-secondary);
}

// 标题栏是拖拽区，交互元素必须显式排除，否则点击会被窗口拖动吞掉
.bar-toggle,
.window-button {
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.bar-toggle {
  width: 32px;
  height: 32px;
  padding: 0;
}

.window-buttons {
  display: flex;
  margin-left: auto;

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
