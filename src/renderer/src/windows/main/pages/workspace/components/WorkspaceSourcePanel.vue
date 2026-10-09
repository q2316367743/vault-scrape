<script setup lang="ts">
import { computed } from 'vue'
import type { FileConnection } from '@common/types/file'
import DirectoryPickerField from '@/components/DirectoryPickerField.vue'
import { toDisplayDir, toRemoteDir } from '../workspaceUtils'

const props = defineProps<{
  connections: FileConnection[]
  activeId: string
  connection: FileConnection | null
  dirPath: string
  scanning: boolean
  /** 任务运行中：数据源与目录都锁定，避免跑到一半换目标 */
  locking: boolean
}>()

const emit = defineEmits<{
  'update:activeId': [value: string]
  'update:dirPath': [value: string]
  scan: []
}>()

const options = computed(() =>
  props.connections.map((connection) => ({ label: connection.name, value: connection.id }))
)

const isLocal = computed(() => props.connection?.protocol === 'local')

/** 本地数据源展示本机绝对路径，其余直接展示连接内路径 */
const dirText = computed(() => toDisplayDir(props.connection, props.dirPath))

function onSelect(value: unknown): void {
  emit('update:activeId', String(value))
}

function onDirInput(value: unknown): void {
  const text = String(value)
  emit('update:dirPath', isLocal.value ? toRemoteDir(props.connection, text) : text)
}
</script>

<template>
  <t-card :bordered="false" title="数据源" class="source-panel">
    <div class="source-field">
      <div class="field-label">存储</div>
      <t-select
        :value="activeId || undefined"
        :options="options"
        :disabled="locking"
        placeholder="请选择存储"
        @change="onSelect"
      />
      <div v-if="connection?.nsfw" class="field-hint">
        <t-tag size="small" theme="danger" variant="light-outline">NSFW</t-tag>
        该存储已标记为敏感内容
      </div>
    </div>

    <div class="source-field">
      <div class="field-label">根目录（只刮削该目录下的文件）</div>
      <directory-picker-field
        v-if="isLocal"
        :model-value="dirText"
        title="选择刮削根目录"
        placeholder="本机目录绝对路径"
        @update:model-value="onDirInput"
      />
      <t-input
        v-else
        :value="dirText"
        placeholder="连接内路径，例如 /movies"
        @change="onDirInput"
      />
      <div class="field-hint">连接内路径：{{ dirPath }}</div>
    </div>

    <t-button
      block
      theme="default"
      variant="outline"
      :loading="scanning"
      :disabled="locking || !connection"
      @click="emit('scan')"
    >
      扫描根目录
    </t-button>
  </t-card>
</template>

<style scoped lang="less">
.source-panel {
  width: 320px;
  flex-shrink: 0;
  border-radius: var(--td-radius-large);
}

.source-field {
  margin-bottom: 16px;
}

.field-label {
  margin-bottom: 8px;
  color: var(--td-text-color-secondary);
  font-size: 13px;
}

.field-hint {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--td-text-color-placeholder);
  font-size: 12px;
  word-break: break-all;
}
</style>
