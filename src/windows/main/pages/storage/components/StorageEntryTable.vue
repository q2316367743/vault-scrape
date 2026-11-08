<script setup lang="ts">
/**
 * 存储页的目录表格：只读，没有任何写操作。
 *
 * 契约：目录 → 打开；媒体（视频 / 图片 / 音频）与 nfo → 预览；其它类型不给入口。
 */
import { BrowseIcon, FolderOpenIcon } from 'tdesign-icons-vue-next'
import type { FileEntry } from '@common/types/file'
import { entryIcon, formatEntryTime, formatFileSize, isPreviewable } from '../storageUtils'

defineProps<{
  /** 当前目录的条目 */
  entries: FileEntry[]
  /** 加载中 */
  loading: boolean
}>()

const emit = defineEmits<{
  open: [entry: FileEntry]
  preview: [entry: FileEntry]
}>()

const columns = [
  { colKey: 'name', title: '名称', ellipsis: true },
  { colKey: 'size', title: '大小', width: 110 },
  { colKey: 'modifiedAt', title: '修改时间', width: 170 },
  { colKey: 'op', title: '操作', width: 88 }
]

/** 目录进得去、可预览文件点得开，其余没有主操作 */
function onEntryClick(entry: FileEntry): void {
  if (entry.type === 'directory') emit('open', entry)
  else if (isPreviewable(entry)) emit('preview', entry)
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
        :class="{ 'is-directory': row.type === 'directory', 'is-clickable': isPreviewable(row) }"
        @click="onEntryClick(row)"
      >
        <component :is="entryIcon(row)" class="entry-icon" />
        <span class="entry-text">{{ row.name }}</span>
      </div>
    </template>

    <template #size="{ row }">{{ formatFileSize(row.size) }}</template>

    <template #modifiedAt="{ row }">{{ formatEntryTime(row.modifiedAt) }}</template>

    <template #op="{ row }">
      <div class="entry-actions">
        <t-tooltip v-if="row.type === 'directory'" content="打开">
          <t-button variant="text" size="small" @click="emit('open', row)">
            <template #icon><folder-open-icon /></template>
          </t-button>
        </t-tooltip>
        <t-tooltip v-else-if="isPreviewable(row)" content="预览">
          <t-button variant="text" size="small" @click="emit('preview', row)">
            <template #icon><browse-icon /></template>
          </t-button>
        </t-tooltip>
        <span v-else class="entry-none">—</span>
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

.entry-name.is-directory,
.entry-name.is-clickable {
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

.entry-name.is-directory:hover .entry-text,
.entry-name.is-clickable:hover .entry-text {
  color: var(--td-brand-color);
}

.entry-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.entry-none {
  color: var(--td-text-color-placeholder);
}
</style>
