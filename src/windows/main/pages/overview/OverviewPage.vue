<template>
  <page-layout title="概览" description="刮削与演员补全进度、历史记录，点记录行查看逐文件结果">
    <div class="stat-grid">
      <stat-card label="任务总数" :value="stats.total" />
      <stat-card label="等待中" :value="stats.pending" />
      <stat-card label="进行中" :value="stats.running" />
      <stat-card label="已成功" :value="stats.success" />
      <stat-card label="已失败" :value="stats.failed" />
      <stat-card label="已取消" :value="stats.paused" />
      <stat-card label="已中断" :value="stats.interrupted" />
    </div>

    <scrape-progress-card
      :task="task"
      :total="total"
      :finished="finished"
      :failed="failed"
      :percentage="percentage"
      :can-cancel="canCancel"
      :can-resume="canResume"
      :acting="acting"
      @cancel="cancel"
      @resume="resume"
    />

    <actor-scrape-progress-card
      class="actor-card"
      :status="actorStatus"
      :has-task="actorHasTask"
      :percentage="actorPercentage"
    />

    <scrape-task-table
      :tasks="tasks"
      :loading="loadingTasks"
      :page="page"
      :page-size="pageSize"
      :total="recordsTotal"
      @update:page="page = $event"
      @update:page-size="pageSize = $event"
      @open="openDetail"
    />
  </page-layout>
</template>

<script setup lang="ts">
/**
 * 概览页：任务统计 + 当前刮削进度 + 演员资料补全进度 + 刮削记录。
 *
 * 契约：
 * - 取数与状态机都在 `useScrapeOverview` / `useActorScrape`，本页只做组装与跳转；
 * - 记录行点击进 `/overview/scrape?taskId=…`（只读的刮削进度详情），
 *   取消 / 继续留在进度卡片，详情页不放动作按钮；
 * - 进度条与记录表共用 `useScrapeTaskDisplay` 的状态文案与配色。
 */
import { useRouter } from 'vue-router'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import ActorScrapeProgressCard from './components/ActorScrapeProgressCard.vue'
import ScrapeProgressCard from './components/ScrapeProgressCard.vue'
import ScrapeTaskTable from './components/ScrapeTaskTable.vue'
import StatCard from './components/StatCard.vue'
import { useActorScrape } from './composables/useActorScrape'
import { useScrapeOverview } from './composables/useScrapeOverview'

const router = useRouter()
const {
  stats,
  tasks,
  recordsTotal,
  page,
  pageSize,
  loadingTasks,
  task,
  acting,
  total,
  finished,
  failed,
  percentage,
  canCancel,
  canResume,
  cancel,
  resume
} = useScrapeOverview()

const {
  status: actorStatus,
  hasTask: actorHasTask,
  percentage: actorPercentage
} = useActorScrape()

function openDetail(taskId: string): void {
  void router.push({ name: '刮削进度详情', query: { taskId } })
}
</script>

<style scoped lang="less">
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.actor-card {
  margin-top: 16px;
}
</style>
