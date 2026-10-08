import { watch } from 'vue'
import { useColorMode } from '@vueuse/core'
import { appWindowApi } from '@/api'

/** 主题模式三档：亮色 / 深色 / 跟随系统（`auto` 是 vueuse `useColorMode` 约定的固定取值） */
export type ThemeMode = 'light' | 'dark' | 'auto'

/**
 * 全局主题状态。
 * `useColorMode` 会把解析后的 light / dark 写成 `<html theme-mode="...">`，这正是 TDesign 深色模式的开关
 * （官方约定：`theme-mode='dark'` 生效、`light` 与不写属性等价）；它同时监听系统偏好，
 * 因此 `auto` 无需自己订阅 `prefers-color-scheme`。
 */
const colorMode = useColorMode({
  attribute: 'theme-mode',
  modes: { light: 'light', dark: 'dark' },
  initialValue: 'auto',
  storageKey: 'vault-scrape:theme-mode'
})

/** 用户选择的主题模式（含跟随系统的 `auto`），持久化在 localStorage；回显必须用它而不是解析结果 */
export const themeMode = colorMode.store

/** 切换主题：只写选择值，换肤与窗口材质同步统一交给下方 watch */
export function setThemeMode(mode: ThemeMode): void {
  themeMode.value = mode
}

/**
 * 窗口材质跟随主题：macOS vibrancy / Windows acrylic 的深浅由主进程的 `nativeTheme` 决定，
 * 渲染层只能改自己的 CSS 变量，不通知主进程的话深色下窗口底色仍是浅的。
 * `immediate` 顺便覆盖启动时的初始同步（重启后材质与上次选择一致）。
 */
watch(
  themeMode,
  (mode) => {
    void appWindowApi.setThemeSource(mode === 'auto' ? 'system' : mode)
  },
  { immediate: true }
)
