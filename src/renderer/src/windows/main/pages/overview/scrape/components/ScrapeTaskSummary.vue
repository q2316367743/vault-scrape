<template>
  <t-card class="task-summary" :bordered="false" title="任务信息">
    <template #actions>
      <t-tag size="small" :theme="TASK_STATUS_THEMES[task.status]" variant="light-outline">
        {{ TASK_STATUS_LABELS[task.status] }}
      </t-tag>
    </template>

    <div class="summary-body">
      <div class="summary-line">
        <span class="summary-label">任务名</span>
        <span class="summary-value">{{ task.name }}</span>
      </div>
      <div class="summary-line">
        <span class="summary-label">目录</span>
        <span class="summary-value">{{ task.dirPath || '—' }}</span>
      </div>
      <div class="summary-line">
        <span class="summary-label">创建</span>
        <span class="summary-value">{{ formatTimestamp(task.createdAt) }}</span>
      </div>
      <div class="summary-line">
        <span class="summary-label">更新</span>
        <span class="summary-value">{{ formatTimestamp(task.updatedAt) }}</span>
      </div>

      <t-progress
        class="summary-progress"
        :percentage="percentage"
        :status="progressStatus"
        :label="task.total > 0 ? `${task.finished}/${task.total}` : false"
      />

      <div class="summary-stats">
        <span>已处理 {{ task.finished }}</span>
        <span>失败 {{ task.failed }}</span>
        <span>计划 {{ task.total }}</span>
      </div>

      <div v-if="task.message" class="summary-message">{{ task.message }}</div>
    </div>
  </t-card>
</template>

<script setup lang="ts">
/**
 * 刮削进度详情的任务概览：任务名、状态、进度与计划量。
 *
 * 契约：只读展示，不含任何动作按钮（取消 / 继续在概览页的进度卡片上）。
 */
import { computed } from 'vue'
import type { ScrapeTaskSnapshot } from '@common/types/scrape'
import {
  TASK_STATUS_LABELS,
  TASK_STATUS_THEMES,
  formatTimestamp,
  toPercentage
} from '../../composables/useScrapeTaskDisplay'

const props = defineProps<{
  task: ScrapeTaskSnapshot
}>()

const percentage = computed(() => toPercentage(props.task.finished, props.task.total))

/** 只有失败任务把进度条染红，其余用组件默认样式 */
const progressStatus = computed<'error' | undefined>(() =>
  props.task.status === 'failed' ? 'error' : undefined
)
</script>

<style scoped lang="less">
.task-summary {
  border-radius: var(--td-radius-large);
}

.summary-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.summary-line {
  display: flex;
  gap: 8px;
  font-size: 13px;
}

.summary-label {
  flex-shrink: 0;
  color: var(--td-text-color-secondary);
}

.summary-value {
  min-width: 0;
  word-break: break-all;
}

.summary-progress {
  margin: 8px 0 4px;
}

.summary-stats {
  display: flex;
  gap: 16px;
  color: var(--td-text-color-secondary);
  font-size: 12px;
}

.summary-message {
  color: var(--td-text-color-placeholder);
  font-size: 12px;
  word-break: break-all;
}
</style>
