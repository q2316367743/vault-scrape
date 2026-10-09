<template>
  <t-table
    row-key="id"
    :data="items"
    :columns="columns"
    :loading="loading"
    size="small"
    hover
    max-height="calc(100vh - 186px)"
  >
    <template #createdAt="{ row }">{{ formatTime(row.createdAt) }}</template>
    <template #level="{ row }">
      <t-tag :theme="levelThemes[row.level as LogLevel]" variant="light">
        {{ levelLabels[row.level as LogLevel] }}
      </t-tag>
    </template>
  </t-table>
</template>
<script setup lang="ts">
import dayjs from 'dayjs'
import type { LogItem, LogLevel } from '@common/types/log'

defineProps<{
  /** 当前页日志 */
  items: LogItem[]
  /** 加载中 */
  loading: boolean
}>()

const columns = [
  { colKey: 'createdAt', title: '时间', width: 170 },
  { colKey: 'level', title: '级别', width: 90 },
  { colKey: 'scope', title: '模块', width: 150, ellipsis: true },
  { colKey: 'message', title: '内容', ellipsis: true }
]

const levelThemes: Record<LogLevel, 'default' | 'primary' | 'warning' | 'danger'> = {
  debug: 'default',
  info: 'primary',
  warn: 'warning',
  error: 'danger'
}

const levelLabels: Record<LogLevel, string> = {
  debug: '调试',
  info: '信息',
  warn: '警告',
  error: '错误'
}

function formatTime(value: number): string {
  return dayjs(value).format('YYYY-MM-DD HH:mm:ss')
}
</script>
