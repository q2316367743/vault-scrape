<script setup lang="ts">
import { computed } from 'vue'
import {
  CheckCircleIcon,
  CloseCircleIcon,
  CloudDownloadIcon,
  CloudUploadIcon,
  DeleteIcon,
  ErrorCircleIcon
} from 'tdesign-icons-vue-next'
import { formatFileSize } from '../storageUtils'
import type { StorageTransferItem } from '../composables/useStorageTransfers'

const props = defineProps<{
  /** 本页发起的传输任务，最新的在最后 */
  items: StorageTransferItem[]
}>()

const emit = defineEmits<{ cancel: [transferId: string]; clear: [] }>()

const finishedCount = computed(
  () => props.items.filter((item) => item.status !== 'running').length
)

function progressOf(item: StorageTransferItem): number {
  if (item.status === 'done') return 100
  if (item.total <= 0) return 0
  return Math.min(100, Math.round((item.transferred / item.total) * 100))
}

function progressStatus(item: StorageTransferItem): 'active' | 'success' | 'error' {
  if (item.status === 'done') return 'success'
  if (item.status === 'failed') return 'error'
  return 'active'
}

function progressLabel(item: StorageTransferItem): string {
  if (item.total > 0) return `${formatFileSize(item.transferred)} / ${formatFileSize(item.total)}`
  return formatFileSize(item.transferred)
}
</script>

<template>
  <section v-if="items.length > 0" class="transfer-panel">
    <header class="transfer-head">
      <span class="transfer-title">传输任务</span>
      <t-button v-if="finishedCount > 0" variant="text" size="small" @click="emit('clear')">
        <template #icon><delete-icon /></template>
        清理已结束（{{ finishedCount }}）
      </t-button>
    </header>

    <ul class="transfer-list">
      <li v-for="item in items" :key="item.transferId" class="transfer-item">
        <cloud-upload-icon v-if="item.kind === 'upload'" class="transfer-icon" />
        <cloud-download-icon v-else class="transfer-icon" />

        <div class="transfer-info">
          <div class="transfer-path" :title="item.path">{{ item.path }}</div>
          <t-progress
            :percentage="progressOf(item)"
            :status="progressStatus(item)"
            :label="progressLabel(item)"
          />
        </div>

        <t-button
          v-if="item.status === 'running'"
          variant="text"
          size="small"
          @click="emit('cancel', item.transferId)"
        >
          <template #icon><close-circle-icon /></template>
          取消
        </t-button>
        <span v-else class="transfer-result" :class="{ 'is-failed': item.status === 'failed' }">
          <error-circle-icon v-if="item.status === 'failed'" />
          <check-circle-icon v-else />
          {{ item.message }}
        </span>
      </li>
    </ul>
  </section>
</template>

<style scoped lang="less">
.transfer-panel {
  flex-shrink: 0;
  margin-top: 12px;
  border: 1px solid var(--fluent-card-border);
  border-radius: var(--fluent-radius-smooth);
  background: var(--td-bg-color-container);
  box-shadow: var(--fluent-elevation-1);
}

.transfer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 38px;
  padding: 0 8px 0 14px;
  border-bottom: 1px solid var(--fluent-card-border);
}

.transfer-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--td-text-color-primary);
}

.transfer-list {
  max-height: 200px;
  margin: 0;
  padding: 4px 14px 8px;
  overflow-y: auto;
  list-style: none;
}

.transfer-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}

.transfer-item + .transfer-item {
  border-top: 1px solid var(--fluent-card-border);
}

.transfer-icon {
  flex-shrink: 0;
  font-size: 16px;
  color: var(--td-brand-color);
}

.transfer-info {
  flex: 1;
  min-width: 0;
}

.transfer-path {
  overflow: hidden;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--td-text-color-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transfer-result {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--td-success-color);
}

.transfer-result.is-failed {
  color: var(--td-error-color);
}
</style>
