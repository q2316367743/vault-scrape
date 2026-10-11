<template>
  <t-card class="progress-card" :bordered="false" title="当前刮削进度">
    <template #actions>
      <t-tag size="small" :theme="statusTheme" variant="light-outline">{{ statusLabel }}</t-tag>
    </template>

    <div v-if="task" class="progress-body">
      <div class="progress-line">
        <span class="progress-label">任务</span>
        <span class="progress-value">{{ task.name }}</span>
      </div>
      <div class="progress-line">
        <span class="progress-label">目录</span>
        <span class="progress-value">{{ task.dirPath || '—' }}</span>
      </div>
      <div class="progress-line">
        <span class="progress-label">更新</span>
        <span class="progress-value">{{ updatedAt }}</span>
      </div>

      <t-progress
        class="progress-bar"
        :percentage="percentage"
        :status="progressStatus"
        :label="total > 0 ? `${finished}/${total}` : false"
      />

      <div class="progress-stats">
        <span>已处理 {{ finished }}</span>
        <span>失败 {{ failed }}</span>
        <span>计划 {{ total }}</span>
      </div>

      <div v-if="task.message" class="progress-message">{{ task.message }}</div>
    </div>

    <t-empty v-else description="当前没有刮削任务" />

    <template #footer>
      <div class="progress-actions">
        <t-button
          v-if="canCancel"
          theme="danger"
          variant="outline"
          :loading="acting"
          @click="emit('cancel')"
        >
          取消任务
        </t-button>
        <t-button
          v-else-if="canResume"
          theme="warning"
          variant="outline"
          :loading="acting"
          @click="emit('resume')"
        >
          继续任务
        </t-button>
        <span v-else class="progress-hint">在影视墙的资料库抽屉里可发起整库刮削</span>
      </div>
    </template>
  </t-card>
</template>

<script setup lang="ts">
/**
 * 概览页的「当前刮削进度」卡片：展示主进程最近一条刮削任务的进度。
 *
 * 契约：
 * - 纯展示 + 两个动作事件，状态与进度的计算都在 `useScrapeOverview`；
 * - 只呈现主进程最近一条任务，与资料库抽屉发起的整库刮削同源；
 * - 取消 / 继续按钮留在本卡片（详情页保持只读），点击进详情的入口在记录表行上。
 */
import { computed } from 'vue'
import type { ScrapeTaskSnapshot } from '@common/types/scrape'
import {
  TASK_STATUS_LABELS,
  TASK_STATUS_THEMES,
  formatTimestamp
} from '../composables/useScrapeTaskDisplay'

const props = defineProps<{
  task: ScrapeTaskSnapshot | null
  total: number
  finished: number
  failed: number
  percentage: number
  canCancel: boolean
  canResume: boolean
  acting: boolean
}>()

const emit = defineEmits<{
  cancel: []
  resume: []
}>()

const statusLabel = computed(() => (props.task ? TASK_STATUS_LABELS[props.task.status] : '未开始'))
const statusTheme = computed(() =>
  props.task ? TASK_STATUS_THEMES[props.task.status] : 'default'
)
const updatedAt = computed(() => (props.task ? formatTimestamp(props.task.updatedAt) : '—'))

/** 只有失败任务把进度条染红，其余用组件默认样式 */
const progressStatus = computed<'error' | undefined>(() =>
  props.task?.status === 'failed' ? 'error' : undefined
)
</script>

<style scoped lang="less">
.progress-card {
  border-radius: var(--td-radius-large);
}

.progress-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.progress-line {
  display: flex;
  gap: 8px;
  font-size: 13px;
}

.progress-label {
  flex-shrink: 0;
  color: var(--td-text-color-secondary);
}

.progress-value {
  min-width: 0;
  word-break: break-all;
}

.progress-bar {
  margin: 8px 0 4px;
}

.progress-stats {
  display: flex;
  gap: 16px;
  color: var(--td-text-color-secondary);
  font-size: 12px;
}

.progress-message {
  color: var(--td-text-color-placeholder);
  font-size: 12px;
  word-break: break-all;
}

.progress-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.progress-hint {
  color: var(--td-text-color-placeholder);
  font-size: 12px;
}
</style>
