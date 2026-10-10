<script setup lang="ts">
/**
 * 工作台：手动刮削入口。
 *
 * 契约：
 * - 流程固定为「选资料库 → 逐级浏览 → 勾选影片 → 排队刮削」，
 *   目录内容来自 `scrape:browse`，因此与影视墙、扫描结果同源；
 * - 这里不再扫盘、不再自己找索引：影视墙的「扫描」才是入库入口；
 * - 任务进度存在主进程，本页只订阅快照，切换 tab / 关窗口再回来进度不变。
 */
import { computed } from 'vue'
import { FILE_ROOT } from '@common/types/file'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import { useWorkspaceScrape } from './composables/useWorkspaceScrape'
import WorkspaceFileTable from './components/WorkspaceFileTable.vue'
import WorkspaceSourcePanel from './components/WorkspaceSourcePanel.vue'
import WorkspaceTaskPanel from './components/WorkspaceTaskPanel.vue'

const {
  libraries,
  libraryId,
  library,
  loadingLibraries,
  dirPath,
  entries,
  browsing,
  selected,
  selectedCount,
  crumbs,
  task,
  submitting,
  running,
  total,
  finished,
  failed,
  percentage,
  canStart,
  canCancel,
  canResume,
  selectLibrary,
  goto,
  enter,
  refresh,
  toggleOne,
  toggleAll,
  start,
  cancel,
  resume
} = useWorkspaceScrape()

/** 空表文案按「没选库 / 库里没影片 / 目录是空的」分级 */
const emptyText = computed(() => {
  if (!library.value) return '还没有资料库，请先到影视墙的「资料库」里新建并扫描'
  if (browsing.value) return '正在读取目录…'
  if (entries.value.length === 0 && dirPath.value === FILE_ROOT) {
    return '这个资料库里还没有影片，先到「资料库」点「扫描」'
  }
  return '这个目录下没有影片或子目录'
})
</script>

<template>
  <page-layout title="工作台" description="手动挑片刮削：选资料库，逐级浏览后勾选影片排队" :padded="false">
    <template #extra>
      <t-tag v-if="running" theme="warning" variant="light-outline">刮削进行中</t-tag>
    </template>

    <div class="workspace-page">
      <workspace-source-panel
        :libraries="libraries"
        :library-id="libraryId"
        :library="library"
        :dir-path="dirPath"
        :crumbs="crumbs"
        :loading="loadingLibraries || browsing"
        :locking="running"
        :selected-count="selectedCount"
        @update:library-id="selectLibrary"
        @navigate="goto"
      />

      <div class="workspace-main">
        <workspace-task-panel
          :task="task"
          :running="running"
          :submitting="submitting"
          :selected-count="selected.length"
          :total="total"
          :finished="finished"
          :failed="failed"
          :percentage="percentage"
          :can-start="canStart"
          :can-cancel="canCancel"
          :can-resume="canResume"
          @start="start"
          @cancel="cancel"
          @resume="resume"
        />

        <workspace-file-table
          :rows="entries"
          :selected="selected"
          :loading="browsing"
          :empty-text="emptyText"
          @enter="enter"
          @toggle="toggleOne"
          @toggle-all="toggleAll"
          @refresh="refresh"
        />
      </div>
    </div>
  </page-layout>
</template>

<style scoped lang="less">
.workspace-page {
  display: flex;
  gap: 16px;
  height: 100%;
  min-height: 0;
  padding: 16px;
  overflow: hidden;
}

.workspace-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  min-height: 0;
}
</style>
