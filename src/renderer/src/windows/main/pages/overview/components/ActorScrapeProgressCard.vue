<template>
  <t-card class="actor-scrape-card" :bordered="false" title="演员资料补全">
    <template #actions>
      <t-tag size="small" :theme="statusTheme" variant="light-outline">{{ statusLabel }}</t-tag>
    </template>

    <div v-if="hasTask" class="progress-body">
      <div class="progress-line">
        <span class="progress-label">当前</span>
        <span class="progress-value">{{ currentName }}</span>
      </div>
      <div class="progress-line">
        <span class="progress-label">更新</span>
        <span class="progress-value">{{ updatedAt }}</span>
      </div>

      <t-progress
        class="progress-bar"
        :percentage="percentage"
        :status="progressStatus"
        :label="`${status.finished}/${status.total}`"
      />

      <div class="progress-stats">
        <span>已处理 {{ status.finished }}</span>
        <span>失败 {{ status.failed }}</span>
        <span>排队中 {{ status.pending }}</span>
        <span>计划 {{ status.total }}</span>
      </div>
    </div>

    <t-empty v-else description="当前没有演员补全任务" />

    <template #footer>
      <span class="progress-hint">
        在演员页点「补全缺失资料」可把资料不全的演员排进队列；队列在主进程串行执行，关掉本页也会继续
      </span>
    </template>
  </t-card>
</template>

<script setup lang="ts">
/**
 * 概览页的「演员资料补全」卡片：展示主进程演员抓取队列的实时状态。
 *
 * 契约：
 * - 纯展示，没有动作按钮（队列不支持取消 —— 单次抓取很快，取消的是发起它的刮削任务）；
 * - 只呈现主进程的内存态：跑空后保留最后一轮数字，应用重启即归零；
 * - 点击进详情的入口不存在：进度粒度为「演员」，逐位结果在日志里看。
 */
import { computed } from 'vue'
import type { ActorScrapeStatus } from '@common/types/actor'
import { formatTimestamp, type StatusTheme } from '../composables/useScrapeTaskDisplay'

const props = defineProps<{
  status: ActorScrapeStatus
  hasTask: boolean
  percentage: number
}>()

const currentName = computed(() => props.status.currentName || '—')
const updatedAt = computed(() => formatTimestamp(props.status.updatedAt))

const statusLabel = computed(() => {
  if (props.status.running) return '补全中'
  if (!props.hasTask) return '空闲'
  return props.status.failed > 0 ? '有失败' : '已完成'
})

const statusTheme = computed<StatusTheme>(() => {
  if (props.status.running) return 'primary'
  if (!props.hasTask) return 'default'
  return props.status.failed > 0 ? 'danger' : 'success'
})

/** 只有跑完且确实有失败才把进度条染红，其余用组件默认样式 */
const progressStatus = computed<'error' | undefined>(() =>
  !props.status.running && props.status.failed > 0 ? 'error' : undefined
)
</script>

<style scoped lang="less">
.actor-scrape-card {
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

.progress-hint {
  color: var(--td-text-color-placeholder);
  font-size: 12px;
}
</style>
