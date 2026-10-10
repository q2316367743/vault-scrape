<template>
  <sub-page-layout
    :title="pageTitle"
    fallback="/media"
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
          :key="item.itemId"
          :item="item"
          :connection="connectionOf(item.connectionId)"
        />
      </div>

      <t-empty
        v-else-if="!failure"
        :title="emptyTitle"
        description="点上方「资料库」扫描后，影片会自动出现在这里"
      />
    </div>
  </sub-page-layout>
</template>
<script setup lang="ts">
/**
 * 影视墙内容页：一个资料库（或「全部影片」）里的影片墙。
 *
 * 契约：
 * - 库由路由 query 决定：`/media/library?libraryId=<id>`，空串表示「全部影片」；
 *   首页的搜索也会把 `keyword` 带过来，作为搜索框初值；
 * - 过滤与排序都在渲染层（见 useMediaWall），资料库的增删改与扫描 / 刮削在抽屉里，
 *   抽屉里任何变更都让本页重拉一次，保证计数与卡片同步；
 * - 卡片的 NSFW 遮罩由卡片自己按所属存储 + 库级标记判定，本页只负责把连接信息传下去。
 */
import { RefreshIcon } from 'tdesign-icons-vue-next'
import { libraryApi } from '@/api'
import SubPageLayout from '@/components/PageLayout/SubPageLayout.vue'
import { useFileConnections } from '@/hooks/UseFileConnections'
import type { FileConnection } from '@common/types/file'
import MediaWallCard from '../components/MediaWallCard.vue'
import { useMediaWall } from './composables/useMediaWall'
import { formatTime } from '@/utils/format'

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

const route = useRoute()

function queryText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

const libraryId = ref(queryText(route.query.libraryId))
const libraryName = ref('')

const { connections, refresh: refreshConnections } = useFileConnections()
const { loading, failure, indexedAt, keyword, sort, visible, scrapedCount, load } =
  useMediaWall(libraryId)

keyword.value = queryText(route.query.keyword)

/** 空库时标题回落「全部影片」，有库但名字还没加载到时回落「资料库」 */
const pageTitle = computed(() => {
  if (libraryId.value.length === 0) return '全部影片'
  return libraryName.value.length > 0 ? libraryName.value : '资料库'
})

const emptyTitle = computed(() =>
  libraryId.value.length === 0 ? '墙上还没有影片' : '这个资料库还没有影片'
)

const summary = computed(() => {
  const indexed = indexedAt.value > 0 ? ` · 索引更新于 ${formatTime(indexedAt.value)}` : ''
  return `共 ${visible.value.length} 部 · 已刮削 ${scrapedCount.value} 部${indexed}`
})

function connectionOf(connectionId: string): FileConnection | null {
  return connections.value.find((connection) => connection.id === connectionId) ?? null
}

function onSortChange(value: unknown): void {
  if (value === 'scraped' || value === 'title' || value === 'size' || value === 'modified') {
    sort.value = value
  }
}

/** 从地址栏进来时只有 ID，库名要自己查一次；抽屉里改过名字也要跟着更新 */
async function loadLibraryName(): Promise<void> {
  if (libraryId.value.length === 0) {
    libraryName.value = ''
    return
  }
  const result = await libraryApi.list()
  if (!result.ok) return
  libraryName.value = result.data.find((library) => library.id === libraryId.value)?.name ?? ''
}

watch(
  () => route.query.libraryId,
  (value) => {
    libraryId.value = queryText(value)
  }
)

onMounted(() => {
  void refreshConnections()
  void loadLibraryName()
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
  width: 260px;
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
