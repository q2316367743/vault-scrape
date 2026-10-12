/**
 * 插件列表的多选状态：选中的 ID 集合、全选 / 反选、以及列表变化后的自动清理。
 *
 * 契约：纯 UI 状态，不落 localStorage——刷新或因删除而变短的列表里，
 * 已不存在的 ID 会被自动淘汰（批量删除后无需手动清空选中）。
 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { PluginSummary } from '@common/types/plugin'

export interface PluginSelection {
  /** 判定单行是否选中（模板里直接 `has`） */
  selectedIds: Ref<Set<string>>
  /** 选中 ID 的数组快照，事件上抛用 */
  selectedList: ComputedRef<string[]>
  selectedCount: ComputedRef<number>
  allSelected: ComputedRef<boolean>
  partialSelected: ComputedRef<boolean>
  toggle: (id: string, checked: boolean) => void
  toggleAll: (checked: boolean) => void
  clear: () => void
}

/** `source` 取当前列表（传 props 的 getter），用于全选与失效清理 */
export function usePluginSelection(source: () => PluginSummary[]): PluginSelection {
  const selectedIds = ref<Set<string>>(new Set())
  const selectedList = computed(() => [...selectedIds.value])
  const selectedCount = computed(() => selectedIds.value.size)
  const allSelected = computed(
    () => source().length > 0 && selectedIds.value.size === source().length
  )
  const partialSelected = computed(() => selectedIds.value.size > 0 && !allSelected.value)

  function toggle(id: string, checked: boolean): void {
    const next = new Set(selectedIds.value)
    if (checked) next.add(id)
    else next.delete(id)
    selectedIds.value = next
  }

  function toggleAll(checked: boolean): void {
    selectedIds.value = checked ? new Set(source().map((item) => item.id)) : new Set()
  }

  function clear(): void {
    selectedIds.value = new Set()
  }

  // 列表刷新（导入 / 删除 / 重排）后淘汰已不存在的 ID
  watch(
    () => source().map((item) => item.id).join('\n'),
    () => {
      const alive = new Set(source().map((item) => item.id))
      const kept = [...selectedIds.value].filter((id) => alive.has(id))
      if (kept.length !== selectedIds.value.size) selectedIds.value = new Set(kept)
    }
  )

  return {
    selectedIds,
    selectedList,
    selectedCount,
    allSelected,
    partialSelected,
    toggle,
    toggleAll,
    clear
  }
}
