<template>
  <div class="scrape-records">
    <t-card :bordered="false" title="刮削记录">
      <t-table
        row-key="id"
        :data="tasks"
        :columns="columns"
        :loading="loading"
        :empty="'暂无刮削记录'"
        :row-class-name="() => 'is-clickable'"
        size="small"
        hover
        @row-click="(context) => emit('open', context.row.id)"
      >
        <template #status="{ row }">
          <t-tag :theme="TASK_STATUS_THEMES[row.status]" variant="light">
            {{ TASK_STATUS_LABELS[row.status] }}
          </t-tag>
        </template>
        <template #progress="{ row }">{{ progressText(row.finished, row.total) }}</template>
        <template #updatedAt="{ row }">{{ formatTimestamp(row.updatedAt) }}</template>
      </t-table>

      <t-pagination
        class="records-pagination"
        :page="page"
        :page-size="pageSize"
        :total="total"
        :page-size-options="[20, 50, 100]"
        @current-change="emit('update:page', $event)"
        @page-size-change="emit('update:pageSize', $event)"
      />
    </t-card>
  </div>
</template>

<script setup lang="ts">
/**
 * 概览页的「刮削记录」表格：任务列表 + 分页，点任意一行进刮削进度详情。
 *
 * 契约：
 * - 数据与分页状态都由 `useScrapeOverview` 持有，本组件只做展示与事件回传；
 * - 行点击回传任务 ID（`open` 事件），跳转由页面负责，组件不碰路由；
 * - 列与状态配色统一走 `useScrapeTaskDisplay`，不在这里硬编码；
 * - 排序列是 `created_at desc`（主进程 `listTask` 的顺序），与分页 offset 一致。
 */
import {
  formatTimestamp,
  TASK_STATUS_LABELS,
  TASK_STATUS_THEMES,
  toPercentage
} from '../composables/useScrapeTaskDisplay'
import type { TaskItem } from '@common/types/task'

defineProps<{
  tasks: TaskItem[]
  loading: boolean
  page: number
  pageSize: number
  total: number
}>()

const emit = defineEmits<{
  'update:page': [page: number]
  'update:pageSize': [pageSize: number]
  open: [taskId: string]
}>()

const columns = [
  { colKey: 'name', title: '任务名', ellipsis: true },
  { colKey: 'status', title: '状态', width: 100 },
  { colKey: 'progress', title: '已处理 / 计划', width: 140 },
  { colKey: 'failed', title: '失败', width: 80 },
  { colKey: 'updatedAt', title: '更新时间', width: 150 }
]

/** 记录表里顺带展示百分比，避免用户再进详情页换算 */
function progressText(finished: number, total: number): string {
  return `${finished} / ${total}（${toPercentage(finished, total)}%）`
}
</script>

<style scoped lang="less">
.scrape-records {
  margin-top: 16px;
  border-radius: var(--td-radius-large);
}

.scrape-records :deep(.is-clickable) {
  cursor: pointer;
}

.records-pagination {
  margin-top: 12px;
  justify-content: flex-end;
}
</style>
