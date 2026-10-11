<template>
  <t-card class="file-results" :bordered="false" :title="`逐文件结果（${files.length}）`">
    <t-table
      row-key="id"
      :data="files"
      :columns="columns"
      :empty="'这条任务还没有逐文件结果'"
      max-height="60vh"
      size="small"
    >
      <template #status="{ row }">
        <t-tag :theme="SCRAPE_FILE_STATUS_THEMES[row.status]" variant="light">
          {{ SCRAPE_FILE_STATUS_LABELS[row.status] }}
        </t-tag>
      </template>
      <template #updatedAt="{ row }">{{ formatTimestamp(row.updatedAt) }}</template>
    </t-table>
  </t-card>
</template>

<script setup lang="ts">
/**
 * 刮削进度详情的逐文件结果表。
 *
 * 契约：
 * - 数据是 `scrape:getTask` 返回的全量快照，进度事件到来时由父页替换对应行；
 * - 文件可能很多，因此用 `max-height` 让表格内部纵向滚动，不做前端分页；
 * - 只读：没有选中、没有操作列。
 */
import { SCRAPE_FILE_STATUS_LABELS, type ScrapeFileItem } from '@common/types/scrape'
import { SCRAPE_FILE_STATUS_THEMES, formatTimestamp } from '../../composables/useScrapeTaskDisplay'

defineProps<{
  files: ScrapeFileItem[]
}>()

const columns = [
  { colKey: 'name', title: '文件', ellipsis: true },
  { colKey: 'title', title: '命中标题', width: 240, ellipsis: true },
  { colKey: 'status', title: '状态', width: 100 },
  { colKey: 'message', title: '说明', width: 240, ellipsis: true },
  { colKey: 'updatedAt', title: '更新时间', width: 150 }
]
</script>

<style scoped lang="less">
.file-results {
  margin-top: 16px;
  border-radius: var(--td-radius-large);
}
</style>
