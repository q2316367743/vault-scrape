<template>
  <div class="panel-head">
    <div class="panel-heading">
      <t-checkbox
        class="check-all"
        :checked="allSelected"
        :indeterminate="partialSelected"
        :disabled="total === 0"
        @change="emit('toggle-all', $event)"
      />
      <span class="panel-title">已安装插件</span>
      <span class="plugin-count">{{ total }}</span>
    </div>
    <div class="panel-actions">
      <t-tooltip content="刷新" placement="top-right">
        <t-button variant="text" size="small" :loading="loading" @click="emit('refresh')">
          <template #icon><refresh-icon /></template>
        </t-button>
      </t-tooltip>
      <t-button theme="primary" size="small" @click="emit('import-plugins')">
        <template #icon><add-icon /></template>
        导入
      </t-button>
    </div>
  </div>

  <div v-if="selectedCount > 0" class="bulk-bar">
    <span class="bulk-text">已选 {{ selectedCount }} 项</span>
    <div class="bulk-actions">
      <t-button size="small" variant="text" @click="emit('set-enabled', true)">启用</t-button>
      <t-button size="small" variant="text" @click="emit('set-enabled', false)">停用</t-button>
      <t-button size="small" variant="text" theme="danger" @click="emit('remove-many')">
        删除
      </t-button>
      <t-button size="small" variant="text" @click="emit('clear')">取消</t-button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 插件列表面板头：左栏自带的「已安装插件 + 全选 + 数量」与「刷新 / 导入」，
 * 有选中项时下面再挂一条批量操作条（启用 / 停用 / 删除 / 取消）。
 *
 * 契约：不碰任何 API，全部动作以事件上抛，由 `PluginList` → `PluginManagerView` 执行；
 * 两个根节点（面板头 + 批量条）都作为 `.plugin-list` 的纵向 flex 子项排布。
 */
import { AddIcon, RefreshIcon } from 'tdesign-icons-vue-next'

defineProps<{
  /** 插件总数 */
  total: number
  loading: boolean
  selectedCount: number
  allSelected: boolean
  /** 部分选中（全选复选框显示半选态） */
  partialSelected: boolean
}>()

const emit = defineEmits<{
  refresh: []
  'import-plugins': []
  'toggle-all': [checked: boolean]
  /** 批量启用 / 停用，选中项由父级补上 */
  'set-enabled': [enabled: boolean]
  /** 批量删除（父级负责确认弹窗与内置插件过滤） */
  'remove-many': []
  clear: []
}>()
</script>

<style scoped lang="less">
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
  height: 40px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--fluent-card-border);
}

// 批量操作条替换列表区上沿：标题行保持不动，避免操作时列表跳动
.bulk-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
  height: 36px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--fluent-card-border);
  background: var(--td-brand-color-light);
}

.bulk-text {
  font-size: 12px;
  color: var(--td-text-color-secondary);
  white-space: nowrap;
}

.bulk-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 2px;
}

.panel-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.panel-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 2px;
}

.panel-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--td-text-color-primary);
}

.plugin-count {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}
</style>
