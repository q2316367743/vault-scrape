<script setup lang="ts">
import { computed } from 'vue'
import type { ScrapeTaskSnapshot } from '@common/types/scrape'
import { TASK_STATUS_LABELS, TASK_STATUS_THEMES, formatTimestamp } from '../workspaceUtils'

const props = defineProps<{
  task: ScrapeTaskSnapshot | null
  running: boolean
  submitting: boolean
  selectedCount: number
  total: number
  finished: number
  failed: number
  percentage: number
  canStart: boolean
  canCancel: boolean
  canResume: boolean
}>()

const emit = defineEmits<{
  start: []
  cancel: []
  resume: []
}>()

const statusLabel = computed(() =>
  props.task ? TASK_STATUS_LABELS[props.task.status] : '未开始'
)

const statusTheme = computed(() =>
  props.task ? TASK_STATUS_THEMES[props.task.status] : 'default'
)

const updatedAt = computed(() => (props.task ? formatTimestamp(props.task.updatedAt) : ''))

/** 只有失败任务把进度条染红，其余用组件默认样式 */
const progressStatus = computed<'error' | undefined>(() =>
  props.task?.status === 'failed' ? 'error' : undefined
)
</script>

<template>
  <t-card :bordered="false" title="刮削任务" class="task-panel">
    <template #actions>
      <t-tag size="small" :theme="statusTheme" variant="light-outline">{{ statusLabel }}</t-tag>
    </template>

    <div class="task-body">
      <div class="task-line">
        <span class="task-label">任务</span>
        <span class="task-value">{{ task ? task.name : '尚未创建任务' }}</span>
      </div>
      <div class="task-line">
        <span class="task-label">目录</span>
        <span class="task-value">{{ task ? task.dirPath : '—' }}</span>
      </div>
      <div v-if="task" class="task-line">
        <span class="task-label">更新</span>
        <span class="task-value">{{ updatedAt }}</span>
      </div>

      <t-progress
        class="task-progress"
        :percentage="percentage"
        :status="progressStatus"
        :label="total > 0 ? `${finished}/${total}` : false"
      />

      <div class="task-stats">
        <span>已处理 {{ finished }}</span>
        <span>失败 {{ failed }}</span>
        <span>计划 {{ total || selectedCount }}</span>
      </div>

      <div v-if="task?.message" class="task-message">{{ task.message }}</div>
      <div v-else class="task-message">
        {{ selectedCount > 0 ? `已勾选 ${selectedCount} 个文件` : '请先勾选要刮削的文件' }}
      </div>
    </div>

    <template #footer>
      <div class="task-actions">
        <t-button
          theme="primary"
          :loading="submitting"
          :disabled="!canStart"
          @click="emit('start')"
        >
          开始刮削
        </t-button>
        <t-button v-if="canCancel" theme="danger" variant="outline" @click="emit('cancel')">
          取消任务
        </t-button>
        <t-button v-else-if="canResume" theme="warning" variant="outline" @click="emit('resume')">
          继续任务
        </t-button>
      </div>
    </template>
  </t-card>
</template>

<style scoped lang="less">
.task-panel {
  border-radius: var(--td-radius-large);
}

.task-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.task-line {
  display: flex;
  gap: 8px;
  font-size: 13px;
}

.task-label {
  flex-shrink: 0;
  color: var(--td-text-color-secondary);
}

.task-value {
  min-width: 0;
  word-break: break-all;
}

.task-progress {
  margin: 8px 0 4px;
}

.task-stats {
  display: flex;
  gap: 16px;
  color: var(--td-text-color-secondary);
  font-size: 12px;
}

.task-message {
  color: var(--td-text-color-placeholder);
  font-size: 12px;
  word-break: break-all;
}

.task-actions {
  display: flex;
  gap: 8px;
}
</style>
