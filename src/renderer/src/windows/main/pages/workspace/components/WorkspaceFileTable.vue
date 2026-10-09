<script setup lang="ts">
import { computed } from 'vue'
import SensitiveImage from '@/components/SensitiveImage.vue'
import type { WorkspaceRow } from '../composables/useWorkspaceScrape'
import { WORKSPACE_STATUS_LABELS, WORKSPACE_STATUS_THEMES } from '../workspaceUtils'

const props = defineProps<{
  rows: WorkspaceRow[]
  selected: string[]
  loading: boolean
  /** 该数据源命中 NSFW 保护时，封面先遮挡、点击后再显示 */
  protect: boolean
}>()

const emit = defineEmits<{
  'update:selected': [value: string[]]
  'update:all': [value: boolean]
}>()

const columns = [
  { colKey: 'row-select', type: 'multiple' as const, width: 48 },
  { colKey: 'cover', title: '封面', width: 72 },
  { colKey: 'name', title: '文件名', ellipsis: true, minWidth: 260 },
  { colKey: 'keyword', title: '搜索关键词', width: 160, ellipsis: true },
  { colKey: 'num', title: '番号', width: 140 },
  { colKey: 'status', title: '状态', width: 220 }
]

/** 重复番号的文件不允许勾选，避免同名资源互相覆盖 */
const selectablePaths = computed(
  () => new Set(props.rows.filter((row) => row.duplicateOf.length === 0).map((row) => row.path))
)

const allSelected = computed(
  () => selectablePaths.value.size > 0 && props.selected.length >= selectablePaths.value.size
)

const indeterminate = computed(
  () => props.selected.length > 0 && props.selected.length < selectablePaths.value.size
)

function onSelectChange(keys: Array<string | number>): void {
  emit(
    'update:selected',
    keys.map((key) => String(key)).filter((key) => selectablePaths.value.has(key))
  )
}

function onSelectAll(checked: boolean): void {
  emit('update:all', checked)
}

function statusTheme(row: WorkspaceRow): 'default' | 'primary' | 'warning' | 'success' | 'danger' {
  return WORKSPACE_STATUS_THEMES[row.status]
}

function statusLabel(row: WorkspaceRow): string {
  return WORKSPACE_STATUS_LABELS[row.status]
}
</script>

<template>
  <t-card :bordered="false" class="file-table" title="待刮削文件">
    <template #actions>
      <t-checkbox
        :checked="allSelected"
        :indeterminate="indeterminate"
        :disabled="selectablePaths.size === 0"
        @change="onSelectAll"
      >
        全选（{{ selected.length }}/{{ selectablePaths.size }}）
      </t-checkbox>
    </template>

    <t-table
      row-key="path"
      size="small"
      hover
      :data="rows"
      :columns="columns"
      :selected-row-keys="selected"
      :loading="loading"
      @select-change="onSelectChange"
    >
      <template #empty>
        <t-empty
          title="还没有扫描结果"
          description="选择存储与根目录后点击「扫描根目录」，只会读取该目录下的文件"
        />
      </template>

      <template #cover="{ row }">
        <sensitive-image
          v-if="row.coverUrl"
          :src="row.coverUrl"
          :protect="props.protect"
          width="48px"
          height="64px"
          fit="cover"
        />
        <span v-else class="cover-empty">—</span>
      </template>

      <template #name="{ row }">
        <span class="file-name">{{ row.name }}</span>
      </template>

      <template #keyword="{ row }">
        <span>{{ row.keyword || '—' }}</span>
      </template>

      <template #num="{ row }">
        <div class="num-cell">
          <span>{{ row.num || '未识别' }}</span>
          <t-tooltip
            v-if="row.duplicateOf"
            :content="`与 ${row.duplicateOf} 番号相同，已自动排除`"
          >
            <t-tag size="small" theme="warning" variant="light-outline">重复</t-tag>
          </t-tooltip>
        </div>
      </template>

      <template #status="{ row }">
        <div class="status-cell">
          <t-tag size="small" :theme="statusTheme(row)" variant="light-outline">
            {{ statusLabel(row) }}
          </t-tag>
          <t-tag v-if="row.pluginId" size="small" variant="outline">{{ row.pluginId }}</t-tag>
          <t-tooltip v-if="row.message" :content="row.message" placement="top-left">
            <span class="status-message">{{ row.message }}</span>
          </t-tooltip>
        </div>
      </template>
    </t-table>
  </t-card>
</template>

<style scoped lang="less">
.file-table {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border-radius: var(--td-radius-large);
}

.file-name {
  word-break: break-all;
}

.cover-empty {
  color: var(--td-text-color-placeholder);
}

.num-cell,
.status-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.status-message {
  overflow: hidden;
  color: var(--td-text-color-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
