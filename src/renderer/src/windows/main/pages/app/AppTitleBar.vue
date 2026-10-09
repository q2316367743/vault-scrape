<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  CloseIcon,
  DesktopIcon,
  Fullscreen1Icon,
  FullscreenExit1Icon,
  MenuFoldIcon,
  MenuUnfoldIcon,
  MinusIcon,
  ModeDarkIcon,
  ModeLightIcon
} from 'tdesign-icons-vue-next'
import { appWindowApi } from '@/api'
import { collapsed, toggleCollapsed } from '@/global/AppState'
import { setThemeMode, themeMode, type ThemeMode } from '@/global/AppTheme'

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

/** 三档主题：按钮图标显示当前档位，下拉面板里高亮当前档位 */
const themeModes: ThemeMode[] = ['light', 'dark', 'auto']
const themeLabels: Record<ThemeMode, string> = { light: '亮色', dark: '深色', auto: '跟随系统' }

const themeOptions = computed(() =>
  themeModes.map((mode) => ({
    content: themeLabels[mode],
    value: mode,
    active: themeMode.value === mode
  }))
)

const themeLabel = computed(() => themeLabels[themeMode.value])

/**
 * 下拉项点击。参数结构来自 TDesign 的 DropdownOption，这里只声明用得到的字段，
 * 用字面量判断收窄成 ThemeMode，避免 `as` 断言。
 */
function onSelectTheme(option: { value?: unknown }): void {
  const mode = option.value
  if (mode === 'light' || mode === 'dark' || mode === 'auto') setThemeMode(mode)
}
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

    <t-dropdown
      trigger="click"
      placement="bottom"
      :options="themeOptions"
      @click="onSelectTheme"
    >
      <t-button class="theme-toggle" variant="text" :aria-label="'外观：' + themeLabel">
        <mode-light-icon v-if="themeMode === 'light'" />
        <mode-dark-icon v-else-if="themeMode === 'dark'" />
        <desktop-icon v-else />
      </t-button>
    </t-dropdown>

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
.theme-toggle,
.window-button {
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.bar-toggle,
.theme-toggle {
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
