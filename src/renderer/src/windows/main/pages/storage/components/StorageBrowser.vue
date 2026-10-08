<script setup lang="ts">
import { computed } from 'vue'
import { AddIcon, FolderAddIcon, RefreshIcon, UploadIcon } from 'tdesign-icons-vue-next'
import { FILE_PROTOCOL_LABELS, type FileConnection } from '@common/types/file'
import { useStorageBrowser } from '../composables/useStorageBrowser'
import { useStorageTransfers } from '../composables/useStorageTransfers'
import { useStorageActions } from '../composables/useStorageActions'
import { PROTOCOL_ICONS } from '../storageUtils'
import StorageEntryTable from './StorageEntryTable.vue'
import StorageTransferList from './StorageTransferList.vue'

const props = defineProps<{
  /** 当前选中的数据源，未选中时展示占位 */
  connection: FileConnection | null
}>()

const connectionId = computed(() => props.connection?.id ?? '')
const browser = useStorageBrowser(connectionId)
const { entries, loading, isRoot, breadcrumb, load, go, goParent, open } = browser

const transfers = useStorageTransfers({
  onSettled: (event) => {
    if (event.ok && event.connectionId === connectionId.value) void load()
  }
})
const { items: transferItems, cancel: cancelTransfer, clearFinished } = transfers

const {
  onCreateFolder,
  onCreateFile,
  onUpload,
  onDownload,
  onRename,
  onCopy,
  onMove,
  onRemove,
  onEditText
} = useStorageActions(connectionId, browser, transfers)
</script>

<template>
  <section class="storage-browser">
    <div v-if="!connection" class="browser-placeholder">
      <t-empty description="请选择左侧数据源，或新建一个连接" />
    </div>

    <template v-else>
      <header class="browser-head">
        <div class="browser-title">
          <component :is="PROTOCOL_ICONS[connection.protocol]" class="browser-title-icon" />
          <span class="browser-title-name">{{ connection.name }}</span>
          <t-tag theme="primary" variant="light">
            {{ FILE_PROTOCOL_LABELS[connection.protocol] }}
          </t-tag>
        </div>
        <div class="browser-toolbar">
          <t-button size="small" variant="outline" :disabled="isRoot" @click="goParent">
            上级目录
          </t-button>
          <t-button size="small" variant="outline" @click="load">
            <template #icon><refresh-icon /></template>
            刷新
          </t-button>
          <t-button size="small" variant="outline" @click="onCreateFolder">
            <template #icon><folder-add-icon /></template>
            新建文件夹
          </t-button>
          <t-button size="small" variant="outline" @click="onCreateFile">
            <template #icon><add-icon /></template>
            新建文件
          </t-button>
          <t-button size="small" theme="primary" @click="onUpload">
            <template #icon><upload-icon /></template>
            上传
          </t-button>
        </div>
      </header>

      <nav class="browser-crumbs">
        <t-breadcrumb>
          <t-breadcrumb-item v-for="(segment, index) in breadcrumb" :key="segment.path">
            <span
              class="crumb"
              :class="{ 'is-current': index === breadcrumb.length - 1 }"
              @click="go(segment.path)"
            >
              {{ segment.label }}
            </span>
          </t-breadcrumb-item>
        </t-breadcrumb>
      </nav>

      <div class="browser-table">
        <storage-entry-table
          :entries="entries"
          :loading="loading"
          @open="open"
          @download="onDownload"
          @edit-text="onEditText"
          @rename="onRename"
          @copy="onCopy"
          @move="onMove"
          @remove="onRemove"
        />
      </div>

      <storage-transfer-list
        :items="transferItems"
        @cancel="cancelTransfer"
        @clear="clearFinished"
      />
    </template>
  </section>
</template>

<style scoped lang="less">
.storage-browser {
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  min-width: 0;
}

.browser-placeholder {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--fluent-card-border);
  border-radius: var(--fluent-radius-smooth);
}

.browser-head {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
}

.browser-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.browser-title-icon {
  font-size: 18px;
  color: var(--td-brand-color);
}

.browser-title-name {
  overflow: hidden;
  font-size: 14px;
  font-weight: 500;
  color: var(--td-text-color-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.browser-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
}

.browser-crumbs {
  flex-shrink: 0;
  padding-bottom: 10px;
}

.crumb {
  font-size: 13px;
  color: var(--td-text-color-secondary);
  cursor: pointer;
  transition: color var(--fluent-transition-fast);
}

.crumb:hover {
  color: var(--td-brand-color);
}

.crumb.is-current {
  color: var(--td-text-color-primary);
  cursor: default;
}

.browser-table {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--fluent-card-border);
  border-radius: var(--fluent-radius-smooth);
  background: var(--td-bg-color-container);
  box-shadow: var(--fluent-elevation-1);
}
</style>
