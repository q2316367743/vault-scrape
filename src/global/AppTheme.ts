/**
 * 主题状态：三档选择（亮 / 深 / 跟随窗口）+ 实际生效主题。
 *
 * 契约：
 * - 用户选择存 core 配置（UiPrefs），不再写 localStorage；
 * - `auto` 档以搭手窗口主题为准（`win.theme()` + `onThemeChanged`），宿主不可用（浏览器预览）
 *   时退化为 `prefers-color-scheme`；
 * - 实际主题写到 `<html theme-mode>`，这是 TDesign 深色模式的开关，也在挂载前定色避免闪屏。
 */
import { computed, ref, watch } from 'vue'
import { hasInternals } from '@dashou/api'
import { getCurrentWindow, type Window as PluginWindow } from '@dashou/api/window'
import { useUiPref } from './UiPrefs'

export type ThemeMode = 'light' | 'dark' | 'auto'
type ThemeName = 'light' | 'dark'

/** 用户选择的主题模式（存 core） */
export const themeMode = useUiPref<ThemeMode>('theme-mode', 'auto')

const media = window.matchMedia('(prefers-color-scheme: dark)')
const systemTheme = ref<ThemeName>(media.matches ? 'dark' : 'light')
const hostTheme = ref<ThemeName | null>(null)

/** 实际生效主题（亮 / 深），供右键菜单等按当前配色选样式 */
export const themeSystem = computed<ThemeName>(() => {
  if (themeMode.value === 'light' || themeMode.value === 'dark') return themeMode.value
  return hostTheme.value ?? systemTheme.value
})

watch(
  themeSystem,
  (theme) => {
    document.documentElement.setAttribute('theme-mode', theme)
  },
  { immediate: true }
)

/** 窗口挂载前调用：接宿主主题 + 监听系统偏好变化 */
export function initTheme(): void {
  media.addEventListener?.('change', (event) => {
    systemTheme.value = event.matches ? 'dark' : 'light'
  })
  if (!hasInternals()) return
  try {
    const win: PluginWindow = getCurrentWindow()
    void win.theme().then((theme) => {
      hostTheme.value = theme === 'dark' ? 'dark' : 'light'
    })
    void win.onThemeChanged((theme) => {
      hostTheme.value = theme === 'dark' ? 'dark' : 'light'
    })
  } catch {
    // 宿主不提供主题时保持系统偏好
  }
}

/** 切换主题：只写选择值，换肤由 themeSystem 的 watch 统一处理 */
export function setThemeMode(mode: ThemeMode): void {
  themeMode.value = mode
}
