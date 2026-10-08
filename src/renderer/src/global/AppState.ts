import { useLocalStorage } from '@vueuse/core'

/**
 * 全局 UI 状态：侧栏折叠。
 * 经 useLocalStorage 持久化到 localStorage（key 与旧实现一致，历史值仍可解析），重启保持。
 */
export const collapsed = useLocalStorage('vault-scrape:collapsed', false)

/** 折叠 / 展开侧栏 */
export function toggleCollapsed(): void {
  collapsed.value = !collapsed.value
}
