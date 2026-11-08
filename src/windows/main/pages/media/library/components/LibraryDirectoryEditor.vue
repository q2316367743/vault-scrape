<template>
  <div class="dir-editor">
    <div v-for="row in rows" :key="row.key" class="path-item">
      <div class="path-line">
        <t-select
          class="path-connection"
          :model-value="row.connectionId"
          :options="connectionOptions"
          placeholder="存储"
          @change="(value: unknown) => onRowChange(row, value)"
        />
        <t-tooltip content="请先选择存储" :disabled="row.connectionId.length > 0">
          <span class="path-pick-wrap">
            <t-button
              variant="outline"
              :disabled="row.connectionId.length === 0"
              @click="emit('pick', row)"
            >
              <template #icon><folder-add-icon /></template>
              选择目录
            </t-button>
          </span>
        </t-tooltip>
        <span class="path-value" :class="{ 'path-value-empty': row.dirValue.trim().length === 0 }">
          {{ row.dirValue.trim() || '尚未选择媒体目录' }}
        </span>
        <t-button
          theme="danger"
          variant="text"
          :disabled="rows.length <= 1"
          @click="emit('remove', row.key)"
        >
          <template #icon><delete-icon /></template>
        </t-button>
      </div>
    </div>

    <t-button variant="outline" @click="emit('add')">
      <template #icon><add-icon /></template>
      添加媒体目录
    </t-button>
    <p class="form-note">一个资料库可以包含多个存储上的多个目录，扫描时会全部递归遍历</p>
  </div>
</template>
<script setup lang="ts">
/**
 * 资料库表单里的「媒体目录」编辑器：每行 = 存储 + 选择目录 + 已选路径 + 删除。
 *
 * 契约：
 * - 只画界面与派发事件，行的增删改由 useLibraryForm 负责（这里不持有状态）；
 * - 目录只能是**连接内路径**，所以「选择目录」必须走远程目录弹窗，不做本机路径换算；
 * - 未选存储时按钮禁用并提示「请先选择存储」。
 */
import { AddIcon, DeleteIcon, FolderAddIcon } from 'tdesign-icons-vue-next'
import type { LibraryPathRow } from '../composables/useLibraryForm'

defineProps<{
  rows: LibraryPathRow[]
  connectionOptions: { value: string; label: string }[]
}>()

const emit = defineEmits<{
  add: []
  pick: [row: LibraryPathRow]
  remove: [key: string]
  change: [row: LibraryPathRow, value: string]
}>()

/** t-select 的 change 只信字符串，非字符串忽略 */
function onRowChange(row: LibraryPathRow, value: unknown): void {
  if (typeof value !== 'string') return
  emit('change', row, value)
}
</script>
<style scoped lang="less">
.path-item {
  margin-bottom: 10px;
}

.path-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.path-connection {
  width: 180px;
  flex-shrink: 0;
}

.path-pick-wrap {
  display: inline-flex;
}

.path-value {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--td-text-color-primary);
  word-break: break-all;
}

.path-value-empty {
  color: var(--td-text-color-placeholder);
}

.form-note {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--td-text-color-placeholder);
}
</style>
