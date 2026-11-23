import { useUiPref } from './UiPrefs'

/**
 * 全局 UI 状态：侧栏折叠。
 * 经 useUiPref 持久化到 core 的配置目录，重启保持、换设备可带走。
 */
export const collapsed = useUiPref<boolean>('collapsed', false)

/** 折叠 / 展开侧栏 */
export function toggleCollapsed(): void {
  collapsed.value = !collapsed.value
}
