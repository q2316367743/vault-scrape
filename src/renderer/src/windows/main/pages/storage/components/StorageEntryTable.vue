<script setup lang="ts">
import { DownloadIcon, FolderOpenIcon, MoreIcon } from 'tdesign-icons-vue-next'
import type { FileEntry } from '@common/types/file'
import { entryIcon, formatEntryTime, formatFileSize, isTextEntry } from '../storageUtils'

defineProps<{
  /** 当前目录的条目 */
  entries: FileEntry[]
  /** 加载中 */
  loading: boolean
}>()

const emit = defineEmits<{
  open: [entry: FileEntry]
  download: [entry: FileEntry]
  'edit-text': [entry: FileEntry]
  rename: [entry: FileEntry]
  copy: [entry: FileEntry]
  move: [entry: FileEntry]
  remove: [entry: FileEntry]
}>()

interface RowAction {
  value: string
  content: string
  theme?: 'error'
}

const columns = [
  { colKey: 'name', title: '名称', ellipsis: true },
  { colKey: 'size', title: '大小', width: 110 },
  { colKey: 'modifiedAt', title: '修改时间', width: 170 },
  { colKey: 'op', title: '操作', width: 110 }
]

/** 目录与文件的操作项不同：目录给“打开”，文件给“下载”，文本文件多一项“编辑文本” */
function rowActions(entry: FileEntry): RowAction[] {
  const actions: RowAction[] = []
  if (entry.type === 'directory') actions.push({ value: 'open', content: '打开' })
  else actions.push({ value: 'download', content: '下载' })
  if (entry.type === 'file' && isTextEntry(entry)) {
    actions.push({ value: 'edit-text', content: '编辑文本' })
  }
  actions.push(
    { value: 'rename', content: '重命名' },
    { value: 'copy', content: '复制到…' },
    { value: 'move', content: '移动到…' },
    { value: 'remove', content: '删除', theme: 'error' }
  )
  return actions
}

function onPrimary(entry: FileEntry): void {
  if (entry.type === 'directory') emit('open', entry)
  else emit('download', entry)
}

function onNameClick(entry: FileEntry): void {
  if (entry.type === 'directory') emit('open', entry)
}

function onAction(entry: FileEntry, payload: unknown): void {
  if (typeof payload !== 'object' || payload === null || !('value' in payload)) return
  const action = String(payload.value)
  if (action === 'open') emit('open', entry)
  else if (action === 'download') emit('download', entry)
  else if (action === 'edit-text') emit('edit-text', entry)
  else if (action === 'rename') emit('rename', entry)
  else if (action === 'copy') emit('copy', entry)
  else if (action === 'move') emit('move', entry)
  else if (action === 'remove') emit('remove', entry)
}
</script>

<template>
  <t-table
    row-key="path"
    :data="entries"
    :columns="columns"
    :loading="loading"
    size="small"
    hover
    empty="当前目录为空"
  >
    <template #name="{ row }">
      <div
        class="entry-name"
        :class="{ 'is-directory': row.type === 'directory' }"
        @click="onNameClick(row)"
      >
        <component :is="entryIcon(row)" class="entry-icon" />
        <span class="entry-text">{{ row.name }}</span>
      </div>
    </template>

    <template #size="{ row }">{{ formatFileSize(row.size) }}</template>

    <template #modifiedAt="{ row }">{{ formatEntryTime(row.modifiedAt) }}</template>

    <template #op="{ row }">
      <div class="entry-actions">
        <t-tooltip :content="row.type === 'directory' ? '打开' : '下载'">
          <t-button variant="text" size="small" @click="onPrimary(row)">
            <template #icon>
              <folder-open-icon v-if="row.type === 'directory'" />
              <download-icon v-else />
            </template>
          </t-button>
        </t-tooltip>
        <t-dropdown :options="rowActions(row)" trigger="click" @click="(data) => onAction(row, data)">
          <t-button variant="text" size="small">
            <template #icon><more-icon /></template>
          </t-button>
        </t-dropdown>
      </div>
    </template>
  </t-table>
</template>

<style scoped lang="less">
.entry-name {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.entry-name.is-directory {
  cursor: pointer;
}

.entry-icon {
  flex-shrink: 0;
  font-size: 16px;
  color: var(--td-text-color-secondary);
}

.entry-name.is-directory .entry-icon {
  color: var(--td-brand-color);
}

.entry-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-name.is-directory:hover .entry-text {
  color: var(--td-brand-color);
}

.entry-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
</style>
