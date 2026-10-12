<template>
  <aside class="plugin-list">
    <plugin-list-header
      :total="plugins.length"
      :loading="loading"
      :selected-count="selectedCount"
      :all-selected="allSelected"
      :partial-selected="partialSelected"
      @refresh="emit('refresh')"
      @import-plugins="emit('import-plugins')"
      @toggle-all="toggleAll"
      @set-enabled="onSetEnabled"
      @remove-many="onRemoveMany"
      @clear="clear"
    />

    <div ref="bodyRef" class="plugin-body">
      <t-loading :loading="loading" size="small">
        <t-list v-if="plugins.length > 0" split size="small">
          <t-list-item
            v-for="plugin in plugins"
            :key="plugin.id"
            class="plugin-item"
            :class="{ 'is-active': plugin.id === activeId }"
            @click="emit('select', plugin.id)"
          >
            <div class="plugin-row">
              <span class="plugin-check" @click.stop>
                <t-checkbox
                  :checked="selectedIds.has(plugin.id)"
                  @change="onCheck(plugin.id, $event)"
                />
              </span>
              <t-tooltip content="按住任意位置拖动即可调整顺序" placement="top-left">
                <span class="drag-handle"><move-icon /></span>
              </t-tooltip>
              <div class="plugin-info">
                <div class="plugin-title">
                  <span class="plugin-name">{{ plugin.name }}</span>
                  <t-tag
                    v-if="plugin.source === 'builtin'"
                    size="small"
                    theme="primary"
                    variant="light"
                  >
                    内置
                  </t-tag>
                </div>
                <div class="plugin-desc" :title="plugin.description || plugin.id">
                  {{ plugin.description || plugin.id }}
                </div>
              </div>
              <div class="plugin-tags">
                <t-tag v-if="plugin.loadError" size="small" theme="danger" variant="light">
                  加载失败
                </t-tag>
                <t-tag v-else-if="!plugin.envReady" size="small" theme="warning" variant="light">
                  待填写变量
                </t-tag>
                <t-tag size="small" :theme="plugin.enabled ? 'success' : 'default'" variant="light">
                  {{ plugin.enabled ? '已启用' : '已停用' }}
                </t-tag>
              </div>
            </div>
          </t-list-item>
        </t-list>
        <t-empty v-else description="还没有插件，点击右上角「导入」选择本机 .js 脚本" />
      </t-loading>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { MoveIcon } from 'tdesign-icons-vue-next'
import Sortable, { type SortableEvent } from 'sortablejs'
import type { PluginSummary } from '@common/types/plugin'
import { usePluginSelection } from '../composables/usePluginSelection'
import PluginListHeader from './PluginListHeader.vue'

const props = defineProps<{
  plugins: PluginSummary[]
  activeId: string
  loading: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  /** 拖拽结束后的完整 ID 顺序（含被拖动项的新位置） */
  reorder: [ids: string[]]
  /** 面板头上的「刷新」，由管理视图重新拉取列表 */
  refresh: []
  /** 面板头上的「导入」，由管理视图走完整的导入 / 覆盖确认流程 */
  'import-plugins': []
  /** 批量启用 / 停用选中的插件 */
  'set-enabled': [ids: string[], enabled: boolean]
  /** 批量删除选中的插件（确认弹窗在管理视图） */
  'remove-many': [ids: string[]]
}>()

const { selectedIds, selectedList, selectedCount, allSelected, partialSelected, toggle, toggleAll, clear } =
  usePluginSelection(() => props.plugins)

function onCheck(id: string, checked: boolean): void {
  toggle(id, checked)
}

function onSetEnabled(enabled: boolean): void {
  emit('set-enabled', selectedList.value, enabled)
}

function onRemoveMany(): void {
  emit('remove-many', selectedList.value)
}

const bodyRef = ref<HTMLElement | null>(null)
let sortable: Sortable | null = null

function destroySortable(): void {
  sortable?.destroy()
  sortable = null
}

/**
 * 拖拽排序：容器取「第一个列表项的父节点」，不假设 tdesign 内部 DOM 层级
 * （`t-list` 外层可能还包一层 ul，Sortable 对不是容器直接子元素的条目会静默失效）。
 * 插件的 key 不变，重排后这个容器会被复用；列表在有 / 无插件之间切换时 DOM 会重建，
 * 因此跟着 `plugins.length` 重新初始化。
 */
function setupSortable(): void {
  destroySortable()
  const container = bodyRef.value?.querySelector<HTMLElement>('.plugin-item')?.parentElement
  if (!container) return
  sortable = Sortable.create(container, {
    animation: 150,
    // 整行都能拖（不限定手柄，手柄只是视觉提示）；没有位移的点击不会触发原生拖拽，仍按选中处理
    draggable: '.plugin-item',
    // 勾选框区域不参与拖拽；也不拦它的 mousedown，否则勾选框会丢掉键盘焦点
    filter: '.plugin-check',
    preventOnFilter: false,
    ghostClass: 'plugin-item-ghost',
    onEnd: (event: SortableEvent) => {
      const { oldIndex, newIndex } = event
      if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return
      const ids = props.plugins.map((item) => item.id)
      const [moved] = ids.splice(oldIndex, 1)
      if (moved === undefined) return
      ids.splice(newIndex, 0, moved)
      emit('reorder', ids)
    }
  })
}

watch([bodyRef, () => props.plugins.length], setupSortable, { flush: 'post' })
onBeforeUnmount(destroySortable)
</script>

<style scoped lang="less">
// 贴边主从布局的左栏：只是一条右侧分隔线，背景透明、不做卡片
.plugin-list {
  display: flex;
  flex-direction: column;
  width: 300px;
  flex-shrink: 0;
  border-right: 1px solid var(--fluent-sidebar-border);
  background: transparent;
  overflow: hidden;
}

.plugin-body {
  flex: 1;
  min-height: 0;
  padding: 6px;
  overflow-y: auto;
}

// 勾选框：点它只做多选，不触发整行的「选中插件」
.plugin-check {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.plugin-item {
  cursor: pointer;
  transition: background var(--fluent-transition-fast, 0.15s ease);

  &:hover {
    background: var(--td-bg-color-container-hover);
  }

  &.is-active {
    background: var(--td-brand-color-light);
  }
}

// 单行两段式：左侧拖拽手柄 + 名称与单行描述（超出省略，完整内容走 tooltip），右侧状态标签
.plugin-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.drag-handle {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--td-text-color-placeholder);
  cursor: grab;

  &:hover {
    color: var(--td-text-color-secondary);
  }

  &:active {
    cursor: grabbing;
  }
}

// 拖拽时被移动项的占位样式（sortablejs 动态加类）
.plugin-item-ghost {
  background: var(--td-brand-color-light);
  opacity: 0.6;
}

.plugin-info {
  flex: 1;
  min-width: 0;
}

.plugin-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.plugin-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  color: var(--td-text-color-primary);
}

.plugin-desc {
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.plugin-tags {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 4px;
}
</style>
