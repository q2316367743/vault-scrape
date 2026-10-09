<script setup lang="ts">
/**
 * 工作台：选存储 → 扫描根目录 → 启动刮削。
 *
 * 契约：
 * - 页面不自己拼业务规则，扫描 / 启动 / 取消 / 继续都交给 `useWorkspaceScrape`；
 * - 任务进度存在主进程，本页只订阅快照，因此切换 tab、关闭窗口再回来进度不变；
 * - 任务运行中锁定数据源与目录，避免中途换目标。
 */
import { computed, onMounted } from 'vue'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import { useFileConnections } from '@/hooks/UseFileConnections'
import { useNsfwProtection } from '@/hooks/UseNsfwProtection'
import { useWorkspaceScrape } from './composables/useWorkspaceScrape'
import WorkspaceFileTable from './components/WorkspaceFileTable.vue'
import WorkspaceSourcePanel from './components/WorkspaceSourcePanel.vue'
import WorkspaceTaskPanel from './components/WorkspaceTaskPanel.vue'

const { connections, activeId, activeConnection, refresh, select } = useFileConnections()
const {
  dirPath,
  task,
  selected,
  scanning,
  submitting,
  running,
  rows,
  total,
  finished,
  failed,
  percentage,
  canStart,
  canCancel,
  canResume,
  toggleAll,
  scan,
  start,
  cancel,
  resume
} = useWorkspaceScrape(activeConnection)
const { active: nsfwActive } = useNsfwProtection(activeConnection)

const loading = computed(() => scanning.value || submitting.value)

/** 显式赋值方法：避免在模板里对 ref 直接赋值 */
function onDirPath(value: string): void {
  dirPath.value = value
}

function onSelected(value: string[]): void {
  selected.value = value
}

onMounted(() => void refresh())
</script>

<template>
  <page-layout title="工作台" description="选择存储与根目录，按插件顺序刮削视频" :padded="false">
    <template #extra>
      <t-tag v-if="nsfwActive" theme="danger" variant="light-outline">NSFW 保护已生效</t-tag>
    </template>

    <div class="workspace-page">
      <workspace-source-panel
        :connections="connections"
        :active-id="activeId"
        :connection="activeConnection"
        :dir-path="dirPath"
        :scanning="scanning"
        :locking="running"
        @update:active-id="select"
        @update:dir-path="onDirPath"
        @scan="scan"
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
          :rows="rows"
          :selected="selected"
          :loading="loading"
          :protect="nsfwActive"
          @update:selected="onSelected"
          @update:all="toggleAll"
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
