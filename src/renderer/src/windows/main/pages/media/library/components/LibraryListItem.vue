<template>
  <div class="library-row">
    <div class="row-main">
      <div class="row-title">
        <span class="row-name">{{ library.name }}</span>
        <t-tag size="small" variant="outline">{{ typeText }}</t-tag>
        <t-tag size="small" variant="outline">{{ library.paths.length }} 个目录</t-tag>
        <t-tag
          size="small"
          :theme="library.scrapers.length > 0 ? 'primary' : 'default'"
          variant="light-outline"
        >
          {{ scraperText }}
        </t-tag>
        <t-tag v-if="library.nsfwProtection" size="small" theme="danger" variant="light-outline">
          NSFW
        </t-tag>
      </div>
      <div class="row-meta">
        <span v-for="path in library.paths" :key="path.id" class="row-dir">
          {{ pathTextOf(path.connectionId, path.path) }}
        </span>
      </div>
      <div class="row-meta">
        <span>{{ summaryText }}</span>
        <span>上次扫描 {{ formatTime(library.lastScanAt) }}</span>
        <span>上次刮削 {{ formatTime(library.lastScrapeAt) }}</span>
      </div>
    </div>

    <div class="row-actions">
      <t-button
        size="small"
        variant="outline"
        :loading="busy && scanning"
        :disabled="scanning"
        @click="emit('scan')"
      >
        扫描
      </t-button>
      <t-tooltip
        v-if="library.scrapers.length === 0"
        content="该资料库未配置刮削器，不执行刮削"
        placement="top"
      >
        <span class="action-wrap">
          <t-button size="small" variant="outline" disabled>刮削</t-button>
        </span>
      </t-tooltip>
      <t-button v-else size="small" variant="outline" :disabled="scanning" @click="emit('scrape')">
        刮削
      </t-button>
      <t-button size="small" variant="text" :disabled="scanning" @click="emit('edit')">编辑</t-button>
      <t-button
        size="small"
        variant="text"
        theme="danger"
        :disabled="scanning"
        @click="emit('remove')"
      >
        删除
      </t-button>
    </div>
  </div>
</template>
<script setup lang="ts">
/**
 * 资料库列表里的一行：类型、目录、刮削器、影片计数、时间，以及扫描 / 刮削 / 编辑 / 删除入口。
 *
 * 契约：
 * - 只展示与派发事件，动作本身（含确认框）由抽屉负责；
 * - 目录按「存储名 · 目录」逐条显示：本地存储显示本机路径，其它协议显示连接内路径；
 * - `scrapers` 为空表示这个库不刮削：标签显示「不刮削」，「刮削」按钮禁用并给出原因。
 */
import { computed } from 'vue'
import { toDisplayDir } from '@/utils/remotePath'
import type { FileConnection } from '@common/types/file'
import { libraryTypeLabel, type MediaLibrary, type MediaLibrarySummary } from '@common/types/library'
import { formatTime } from '@/utils/format'

const props = defineProps<{
  library: MediaLibrary
  connections: FileConnection[]
  /** 影视墙算好的计数，还没加载到时为 undefined */
  summary?: MediaLibrarySummary
  /** 是否有扫描在跑（全局） */
  scanning: boolean
  /** 是否正在操作这个库 */
  busy: boolean
}>()

const emit = defineEmits<{ scan: []; scrape: []; edit: []; remove: [] }>()

const typeText = computed(() => libraryTypeLabel(props.library.type))

/** 空刮削器不再是错误状态，只表示这个库不刮削 */
const scraperText = computed(() =>
  props.library.scrapers.length > 0 ? `${props.library.scrapers.length} 个刮削器` : '不刮削'
)

const summaryText = computed(() => {
  const summary = props.summary
  if (!summary) return '还没有影片'
  return `影片 ${summary.videoCount} 部 · 已刮削 ${summary.scrapedCount} 部`
})

function pathTextOf(connectionId: string, path: string): string {
  const connection = props.connections.find((item) => item.id === connectionId) ?? null
  const name = connection?.name ?? '存储已删除'
  return `${name} · ${toDisplayDir(connection, path)}`
}
</script>
<style scoped lang="less">
.library-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-medium);
  background-color: var(--td-bg-color-container);
}

.row-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.row-title {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.row-name {
  font-size: 14px;
  color: var(--td-text-color-primary);
}

.row-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
  flex-wrap: wrap;
}

.row-dir {
  word-break: break-all;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.action-wrap {
  display: inline-flex;
}
</style>
