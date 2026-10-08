<script setup lang="ts">
import { onMounted, ref } from 'vue'
import dayjs from 'dayjs'
import { dbApi } from '@/api'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import type { TaskItem, TaskStats, TaskStatus } from '@common/types/task'
import StatCard from './components/StatCard.vue'

const stats = ref<TaskStats>({ total: 0, pending: 0, running: 0, success: 0, failed: 0 })
const tasks = ref<TaskItem[]>([])
const loading = ref(true)

const columns = [
  { colKey: 'name', title: '任务名', ellipsis: true },
  { colKey: 'status', title: '状态', width: 100 },
  { colKey: 'progress', title: '进度', width: 110 },
  { colKey: 'updatedAt', title: '更新时间', width: 170 }
]

const statusThemes: Record<TaskStatus, 'default' | 'primary' | 'success' | 'danger'> = {
  pending: 'default',
  running: 'primary',
  success: 'success',
  failed: 'danger'
}

const statusLabels: Record<TaskStatus, string> = {
  pending: '等待',
  running: '进行中',
  success: '成功',
  failed: '失败'
}

function formatTime(value: number): string {
  return dayjs(value).format('YYYY-MM-DD HH:mm:ss')
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const [statResult, taskResult] = await Promise.all([
      dbApi.task.stats(),
      dbApi.task.list({ limit: 5 })
    ])
    stats.value = statResult
    tasks.value = taskResult
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <page-layout title="概览" description="刮削任务的整体情况">
    <div class="stat-grid">
      <stat-card label="任务总数" :value="stats.total" />
      <stat-card label="等待中" :value="stats.pending" />
      <stat-card label="进行中" :value="stats.running" />
      <stat-card label="已成功" :value="stats.success" />
      <stat-card label="已失败" :value="stats.failed" />
    </div>

    <t-card class="recent-card" title="最近任务" :bordered="false">
      <t-table
        row-key="id"
        :data="tasks"
        :columns="columns"
        :loading="loading"
        size="small"
        hover
      >
        <template #status="{ row }">
          <t-tag :theme="statusThemes[row.status as TaskStatus]" variant="light">
            {{ statusLabels[row.status as TaskStatus] }}
          </t-tag>
        </template>
        <template #progress="{ row }">{{ row.finished }} / {{ row.total }}</template>
        <template #updatedAt="{ row }">{{ formatTime(row.updatedAt) }}</template>
      </t-table>
    </t-card>
  </page-layout>
</template>

<style scoped lang="less">
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.recent-card {
  border-radius: var(--td-radius-large);
}
</style>
