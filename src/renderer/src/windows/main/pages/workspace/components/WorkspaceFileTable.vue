<template>
  <t-card title="目录内容" class="file-table">
    <template #actions>
      <div class="table-actions">
        <t-checkbox
          :checked="allSelected"
          :indeterminate="indeterminate"
          :disabled="movieCount === 0"
          @change="onToggleAll"
        >
          全选（{{ selected.length }}/{{ movieCount }}）
        </t-checkbox>
        <t-button size="small" variant="outline" :loading="loading" @click="emit('refresh')">
          刷新
        </t-button>
      </div>
    </template>

    <t-table
      row-key="itemId"
      size="small"
      hover
      :data="rows"
      :columns="columns"
      :loading="loading"
    >
      <template #empty>
        <p class="empty-text">{{ emptyText }}</p>
      </template>
      <template #select="{ row }">
        <t-checkbox
          :checked="selected.includes(row.itemId)"
          :disabled="row.type !== 'movie'"
          @change="(checked: boolean) => emit('toggle', row.itemId, checked)"
        />
      </template>
      <template #name="{ row }">
        <div class="cell-name">
          <component :is="row.type === 'folder' ? FolderIcon : FilmIcon" class="cell-icon" />
          <t-button
            v-if="row.type === 'folder'"
            size="small"
            variant="text"
            @click="emit('enter', row)"
          >
            {{ row.name }}
          </t-button>
          <span v-else class="cell-title" :title="row.name">{{ row.name }}</span>
          <t-tag v-if="row.type === 'movie' && row.num.length > 0" size="small" variant="outline">
            {{ row.num }}
          </t-tag>
        </div>
      </template>
      <template #type="{ row }">
        <t-tag size="small" :theme="row.type === 'folder' ? 'default' : 'primary'" variant="light">
          {{ row.type === 'folder' ? '目录' : '影片' }}
        </t-tag>
      </template>
      <template #size="{ row }">
        <span>{{ row.type === 'folder' ? '—' : formatSize(row.size) }}</span>
      </template>
      <template #modifiedAt="{ row }">
        <span>{{ formatTimestamp(row.modifiedAt) }}</span>
      </template>
      <template #status="{ row }">
        <div v-if="row.type === 'movie'" class="cell-status">
          <t-tag size="small" :theme="row.scraped ? 'success' : 'default'" variant="light-outline">
            {{ row.scraped ? '已刮削' : '未刮削' }}
          </t-tag>
          <t-tag v-if="!row.hasSource" size="small" theme="warning" variant="light-outline">
            没有播放源
          </t-tag>
        </div>
        <span v-else>—</span>
      </template>
    </t-table>
  </t-card>
</template>
<script setup lang="ts">
/**
 * 工作台目录列表：目录行可下钻，影片行可勾选，其余列只做展示。
 *
 * 契约：
 * - 勾选状态由父级持有（`selected` 是条目 ID 数组），本组件只发 `toggle` / `toggle-all`；
 * - 状态列展示的是条目是否已刮削，不展示任务逐文件进度（那属于任务卡片）。
 */
import { computed } from 'vue'
import { FilmIcon, FolderIcon } from 'tdesign-icons-vue-next'
import type { MediaBrowseEntry } from '@common/types/media'
import { formatSize } from '@/utils/format'
import { formatTimestamp } from '../workspaceUtils'

const props = defineProps<{
  rows: MediaBrowseEntry[]
  /** 已勾选的条目 ID */
  selected: string[]
  loading: boolean
  /** 空表文案，由页面按「没选库 / 库里没内容 / 目录是空的」给出 */
  emptyText: string
}>()

const emit = defineEmits<{
  enter: [entry: MediaBrowseEntry]
  toggle: [itemId: string, checked: boolean]
  'toggle-all': [checked: boolean]
  refresh: []
}>()

const columns = [
  { colKey: 'select', title: '选择', width: 64 },
  { colKey: 'name', title: '名称', ellipsis: true, minWidth: 240 },
  { colKey: 'type', title: '类型', width: 88 },
  { colKey: 'size', title: '大小', width: 110 },
  { colKey: 'modifiedAt', title: '修改时间', width: 160 },
  { colKey: 'status', title: '刮削状态', width: 170 }
]

const movieCount = computed(() => props.rows.filter((row) => row.type === 'movie').length)
const selectedMovies = computed(() =>
  props.rows.filter((row) => row.type === 'movie' && props.selected.includes(row.itemId)).length
)
const allSelected = computed(() => movieCount.value > 0 && selectedMovies.value === movieCount.value)
const indeterminate = computed(
  () => selectedMovies.value > 0 && selectedMovies.value < movieCount.value
)

function onToggleAll(checked: boolean): void {
  emit('toggle-all', checked)
}
</script>
<style scoped lang="less">
.file-table {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.table-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.cell-name {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.cell-icon {
  flex-shrink: 0;
  color: var(--td-text-color-placeholder);
}

.cell-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-status {
  display: flex;
  align-items: center;
  gap: 6px;
}

.empty-text {
  margin: 0;
  font-size: 13px;
  color: var(--td-text-color-placeholder);
}
</style>
