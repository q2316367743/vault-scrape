<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { DialogPlugin, MessagePlugin } from 'tdesign-vue-next'
import { dbApi } from '@/api'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import type { LogItem, LogLevel, LogQuery } from '@common/types/log'
import LogTable from './components/LogTable.vue'

type LevelFilter = LogLevel | 'all'

const levelFilter = ref<LevelFilter>('all')
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const items = ref<LogItem[]>([])
const loading = ref(false)

const levelOptions: { value: LevelFilter; label: string }[] = [
  { value: 'all', label: '全部级别' },
  { value: 'debug', label: '调试' },
  { value: 'info', label: '信息' },
  { value: 'warn', label: '警告' },
  { value: 'error', label: '错误' }
]

function buildQuery(): LogQuery {
  const query: LogQuery = { offset: (page.value - 1) * pageSize.value, limit: pageSize.value }
  if (levelFilter.value !== 'all') query.level = levelFilter.value
  return query
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const query = buildQuery()
    const [rows, count] = await Promise.all([dbApi.log.list(query), dbApi.log.count(query)])
    items.value = rows
    total.value = count
  } finally {
    loading.value = false
  }
}

function resetToFirstPage(): void {
  if (page.value === 1) {
    void load()
    return
  }
  page.value = 1
}

function onClear(): void {
  const dialog = DialogPlugin.confirm({
    header: '清空日志',
    body: '将删除全部日志记录，且不可恢复。',
    theme: 'warning',
    onConfirm: async () => {
      await dbApi.log.clear()
      dialog.hide()
      MessagePlugin.success('日志已清空')
      page.value = 1
      await load()
    }
  })
}

watch(levelFilter, resetToFirstPage)
watch(pageSize, resetToFirstPage)
watch(page, () => {
  void load()
})

onMounted(load)
</script>

<template>
  <page-layout title="日志" description="日志写入本地数据库，最多保留最近的记录">
    <template #extra>
      <t-select v-model="levelFilter" class="log-level" :options="levelOptions" />
      <t-button theme="danger" variant="outline" :disabled="total === 0" @click="onClear">
        清空日志
      </t-button>
    </template>

    <div class="log-table">
      <log-table :items="items" :loading="loading" />
    </div>

    <t-pagination
      v-model="page"
      v-model:page-size="pageSize"
      class="log-pagination"
      :total="total"
      :page-size-options="[20, 50, 100]"
    />
  </page-layout>
</template>

<style scoped lang="less">
.log-level {
  width: 140px;
}

.log-table {
  margin-bottom: 16px;
}

.log-pagination {
  justify-content: flex-end;
}
</style>
