<script setup lang="ts">
/**
 * 离线数据包面板：内置 r18-offline 插件的数据源管理。
 *
 * 契约：检查 / 下载导入 / 本地导入 / 删除都走 useOfflineData（页面上唯一的离线状态源），
 * 破坏性操作先走命令式确认弹窗；导入进度由主进程推送，取消即丢弃临时文件。
 */
import { computed, onMounted } from 'vue'
import { DialogPlugin } from 'tdesign-vue-next'
import { DeleteIcon, DownloadIcon, FolderOpenIcon, RefreshIcon } from 'tdesign-icons-vue-next'
import { formatBytes, formatTime } from '@common/types/offline'
import { useOfflineData } from '../composables/useOfflineData'

const {
  status,
  progress,
  busy,
  running,
  phaseLabel,
  refresh,
  check,
  download,
  importLocal,
  cancel,
  remove
} = useOfflineData()

onMounted(() => void refresh())

const installed = computed(() => status.value?.installed === true)
const percentValue = computed(() => Math.max(0, progress.value?.percent ?? 0))
const rowsText = computed(() => {
  const rows = progress.value?.rows ?? 0
  if (rows <= 0) return ''
  return progress.value?.table ? `已导入 ${rows} 行 · ${progress.value.table}` : `已导入 ${rows} 行`
})

function showTime(at: number): string {
  return at > 0 ? formatTime(at) : '—'
}

function onDownload(): void {
  const dialog = DialogPlugin.confirm({
    header: '下载并导入最新数据包',
    body: '将从 r18.dev 下载最新全量数据包（约 261 MB）并在本机重建离线库，导入期间请勿退出应用。',
    theme: 'warning',
    onConfirm: async () => {
      dialog.hide()
      await download()
    }
  })
}

function onRemove(): void {
  const dialog = DialogPlugin.confirm({
    header: '删除离线数据包',
    body: '只删除本机的离线库文件，不影响系统数据库与已刮削的内容；下次可重新导入。',
    theme: 'danger',
    onConfirm: async () => {
      dialog.hide()
      await remove()
    }
  })
}
</script>

<template>
  <section class="offline-panel">
    <header class="panel-head">
      <div class="panel-title">
        <h4 class="panel-name">离线数据包</h4>
        <span class="panel-sub">
          r18.dev 每月全量数据包，用于本机离线刮削番号与基础信息（保底数据源）
        </span>
      </div>
      <div class="panel-actions">
        <t-button size="small" variant="outline" :loading="busy" :disabled="running" @click="check">
          <template #icon><refresh-icon /></template>
          检查更新
        </t-button>
        <t-button
          size="small"
          theme="primary"
          :loading="busy"
          :disabled="running"
          @click="onDownload"
        >
          <template #icon><download-icon /></template>
          下载并导入
        </t-button>
        <t-button size="small" variant="outline" :disabled="running" @click="importLocal">
          <template #icon><folder-open-icon /></template>
          本地导入
        </t-button>
        <t-button
          size="small"
          theme="danger"
          variant="outline"
          :disabled="running || !installed"
          @click="onRemove"
        >
          <template #icon><delete-icon /></template>
          删除
        </t-button>
      </div>
    </header>

    <t-alert v-if="status?.corrupt" theme="error" message="离线数据包已损坏，请重新导入" />
    <t-alert
      v-else-if="status?.updateAvailable"
      theme="warning"
      :message="`发现新数据包 ${status.latestPackDate}，当前为 ${status.packDate || '未安装'}`"
    />

    <div v-if="progress" class="panel-progress">
      <div class="progress-head">
        <span class="progress-text">{{ phaseLabel }} · {{ progress.message }}</span>
        <span v-if="rowsText" class="progress-rows">{{ rowsText }}</span>
        <t-button size="small" theme="danger" variant="text" @click="cancel">取消</t-button>
      </div>
      <t-progress :percentage="percentValue" :label="false" />
    </div>

    <dl class="panel-meta">
      <div class="meta-item">
        <dt>状态</dt>
        <dd>
          <t-tag v-if="status?.corrupt" theme="danger" variant="light">已损坏</t-tag>
          <t-tag v-else-if="installed" theme="success" variant="light">已安装</t-tag>
          <t-tag v-else theme="default" variant="light">未安装</t-tag>
        </dd>
      </div>
      <div class="meta-item">
        <dt>数据包日期</dt>
        <dd>{{ status?.packDate || '—' }}</dd>
      </div>
      <div class="meta-item">
        <dt>导入时间</dt>
        <dd>{{ showTime(status?.importedAt ?? 0) }}</dd>
      </div>
      <div class="meta-item">
        <dt>上次检查</dt>
        <dd>{{ showTime(status?.lastCheckAt ?? 0) }}</dd>
      </div>
      <div class="meta-item">
        <dt>影片数量</dt>
        <dd>{{ installed ? `${(status?.videoCount ?? 0).toLocaleString('en-US')} 部` : '—' }}</dd>
      </div>
      <div class="meta-item">
        <dt>库文件大小</dt>
        <dd>{{ installed ? formatBytes(status?.dbBytes ?? 0) : '—' }}</dd>
      </div>
      <div class="meta-item meta-wide">
        <dt>库文件</dt>
        <dd class="meta-path">{{ status?.dbPath || '—' }}</dd>
      </div>
    </dl>

    <p class="panel-tip">
      上游每周二滚动发布全量数据包；导入后占用约 1.8 GB 磁盘。封面与预告片不在数据包内，
      仍会在刮削时联网从 DMM 获取。
    </p>
  </section>
</template>

<style scoped lang="less">
.offline-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--td-border-level-1-color);
  border-radius: 6px;
  background: var(--td-bg-color-container);
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.panel-title {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.panel-name {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--td-text-color-primary);
}

.panel-sub {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.panel-progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.progress-head {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
}

.progress-text {
  flex: 1;
  min-width: 0;
  color: var(--td-text-color-primary);
}

.progress-rows {
  color: var(--td-text-color-placeholder);
}

.panel-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 24px;
  margin: 0;
  font-size: 13px;
}

.meta-wide {
  grid-column: 1 / -1;
}

.meta-item {
  display: flex;
  gap: 8px;
  min-width: 0;

  dt {
    width: 84px;
    flex-shrink: 0;
    color: var(--td-text-color-placeholder);
  }

  dd {
    margin: 0;
    min-width: 0;
    color: var(--td-text-color-primary);
  }
}

.meta-path {
  word-break: break-all;
}

.panel-tip {
  margin: 0;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}
</style>
