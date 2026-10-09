<template>
  <page-layout
    title="影视墙"
    description="磁盘上的视频聚成一堵墙，标题与封面来自刮削记录与同目录 NFO"
  >
    <template #extra>
      <t-button variant="outline" :loading="loading" @click="load">
        <template #icon><refresh-icon /></template>
        刷新
      </t-button>
    </template>

    <div class="media-wall">
      <div class="wall-toolbar">
        <t-input
          v-model="keyword"
          class="wall-search"
          placeholder="搜索标题、番号或文件名"
          clearable
        />
        <t-select
          class="wall-select"
          :model-value="sourceId"
          :options="sourceOptions"
          placeholder="全部数据源"
          @change="onSourceChange"
        />
        <t-select
          class="wall-select"
          :model-value="sort"
          :options="SORT_OPTIONS"
          placeholder="排序"
          @change="onSortChange"
        />
        <span class="wall-summary">{{ summary }}</span>
      </div>

      <t-alert v-if="failure" theme="error" :message="failure" />

      <t-loading v-if="loading && visible.length === 0" size="small" text="正在整理影视墙…" />

      <div v-else-if="visible.length > 0" class="wall-grid">
        <media-wall-card
          v-for="item in visible"
          :key="`${item.connectionId}:${item.path}`"
          :item="item"
          :connection="connectionOf(item.connectionId)"
          :source-name="sourceNameOf(item.connectionId)"
        />
      </div>

      <t-empty
        v-else-if="!failure"
        title="墙上还没有影片"
        description="先到「工作台」扫描并刮削视频，或到「存储」刷新资源索引，影片会自动出现在这里"
      />
    </div>
  </page-layout>
</template>
<script setup lang="ts">
/**
 * 影视墙页：把资源索引里的视频聚合成一堵墙，刮削记录只用来补标题与封面。
 *
 * 契约：
 * - 墙面以磁盘为准：磁盘上删掉的影片会随下一次加载自动消失，这里不缓存作品；
 * - 整墙一次拉全，搜索 / 数据源筛选 / 排序都在渲染层做（见 useMediaWall）；
 * - 卡片的 NSFW 遮罩由卡片自己按所属存储判定，本页只负责把连接信息与名称传下去。
 */
import { computed, onMounted } from 'vue'
import { RefreshIcon } from 'tdesign-icons-vue-next'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import { useFileConnections } from '@/hooks/UseFileConnections'
import type { FileConnection } from '@common/types/file'
import MediaWallCard from './components/MediaWallCard.vue'
import { MEDIA_SOURCE_ALL, useMediaWall } from './composables/useMediaWall'
import { formatTime } from './mediaUtils'

interface WallOption {
  value: string
  label: string
}

const SORT_OPTIONS: WallOption[] = [
  { value: 'scraped', label: '已刮削优先' },
  { value: 'title', label: '按标题' },
  { value: 'size', label: '按体积' },
  { value: 'modified', label: '按磁盘时间' }
]

const { connections, refresh: refreshConnections } = useFileConnections()
const { loading, failure, indexedAt, keyword, sourceId, sort, visible, scrapedCount, load } =
  useMediaWall()

const sourceOptions = computed<WallOption[]>(() => [
  { value: MEDIA_SOURCE_ALL, label: '全部数据源' },
  ...connections.value.map((connection) => ({ value: connection.id, label: connection.name }))
])

const summary = computed(() => {
  const indexed = indexedAt.value > 0 ? ` · 索引更新于 ${formatTime(indexedAt.value)}` : ''
  return `共 ${visible.value.length} 部 · 已刮削 ${scrapedCount.value} 部${indexed}`
})

function connectionOf(connectionId: string): FileConnection | null {
  return connections.value.find((connection) => connection.id === connectionId) ?? null
}

function sourceNameOf(connectionId: string): string {
  return connectionOf(connectionId)?.name ?? ''
}

function onSourceChange(value: unknown): void {
  if (typeof value === 'string') sourceId.value = value
}

function onSortChange(value: unknown): void {
  if (value === 'scraped' || value === 'title' || value === 'size' || value === 'modified') {
    sort.value = value
  }
}

onMounted(() => {
  void refreshConnections()
  void load()
})
</script>
<style scoped lang="less">
.media-wall {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.wall-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.wall-search {
  width: 280px;
}

.wall-select {
  width: 180px;
}

.wall-summary {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.wall-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
}
</style>
