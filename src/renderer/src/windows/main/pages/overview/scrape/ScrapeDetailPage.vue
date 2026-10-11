<template>
  <sub-page-layout
    title="刮削进度详情"
    :description="description"
    fallback="/overview"
  >
    <div class="scrape-detail">
      <t-loading v-if="loading && !task" size="small" text="正在读取刮削任务…" />

      <template v-else-if="task">
        <scrape-task-summary :task="task" />
        <scrape-file-result-table :files="files" />
      </template>

      <t-empty v-else :description="failure || '没有读到这条刮削任务'" />
    </div>
  </sub-page-layout>
</template>

<script setup lang="ts">
/**
 * 刮削进度详情页（`/overview/scrape?taskId=…`）：任务进度 + 逐文件结果。
 *
 * 契约：
 * - 参数只从路由 query 读（`taskId`），可以直接刷新、重复进入；
 * - 只读页面：取消 / 继续任务留在概览页的进度卡片，这里不放动作按钮；
 * - 返回按钮由 SubPageLayout 提供，本页不在 `#extra` 里再放；
 * - 运行中的任务靠 `scrape:progress` 增量更新，任务结束后事件停止但快照已是最新。
 */
import { computed } from 'vue'
import SubPageLayout from '@/components/PageLayout/SubPageLayout.vue'
import ScrapeFileResultTable from './components/ScrapeFileResultTable.vue'
import ScrapeTaskSummary from './components/ScrapeTaskSummary.vue'
import { useScrapeTaskDetail } from './composables/useScrapeTaskDetail'

const { taskId, task, files, loading, failure } = useScrapeTaskDetail()

const description = computed(() => (task.value ? task.value.name : taskId))
</script>

<style scoped lang="less">
.scrape-detail {
  display: flex;
  flex-direction: column;
}
</style>
