<template>
  <page-layout
    title="影视墙"
    description="把磁盘上的视频收进资料库，刮削后按最近添加 / 待刮削 / 推荐浏览"
  >
    <template #extra>
      <t-button variant="outline" :loading="loading" @click="load">
        <template #icon><refresh-icon /></template>
        刷新
      </t-button>
    </template>

    <div class="media-home">
      <div class="home-toolbar">
        <t-input
          v-model="keyword"
          class="home-search"
          placeholder="搜索标题、番号或文件名，回车到影片列表"
          clearable
          @enter="onSearch"
        />
        <t-button theme="primary" variant="outline" @click="openDrawer">
          <template #icon><collection-icon /></template>
          资料库
        </t-button>
        <t-button variant="outline" @click="goAll">全部影片</t-button>
        <span class="home-summary">{{ summary }}</span>
      </div>

      <t-alert v-if="failure" theme="error" :message="failure" />

      <t-loading v-if="loading && rows.length === 0" size="small" text="正在整理影视墙…" />

      <template v-else>
        <section class="home-row">
          <div class="row-head">
            <span class="row-title">资料库</span>
            <span class="row-count">{{ libraries.length }} 个</span>
          </div>
          <div v-if="libraries.length > 0" class="row-scroll">
            <library-card v-for="library in libraries" :key="library.id" :library="library" />
          </div>
          <t-empty
            v-else
            title="还没有资料库"
            description="点上方「资料库」新建资料库并扫描，影片会自动出现在这里"
          />
        </section>

        <section v-for="row in visibleRows" :key="row.id" class="home-row">
          <div class="row-head">
            <span class="row-title">{{ row.title }}</span>
            <span class="row-count">{{ row.items.length }} 部</span>
          </div>
          <div class="row-scroll">
            <media-wall-card
              v-for="item in row.items"
              :key="item.itemId"
              :item="item"
              :connection="connectionOf(item.connectionId)"
            />
          </div>
        </section>
      </template>
    </div>
  </page-layout>
</template>
<script setup lang="ts">
/**
 * 影视墙首页（Jellyfin 式）：资料库横排 + 最近添加 / 待刮削 / 推荐三排。
 *
 * 契约：
 * - 数据全部来自 `mediaApi.home()`，三排的顺序、标题与每排上限由主进程决定，
 *   渲染层不重排、不合并，整排为空就整排不渲染；
 * - 搜索框回车后跳到内容页（`/media/library`）并把关键词带过去，关键词为空则不带；
 *   「全部影片」按钮同样跳到内容页，但不带关键词；
 * - 资料库的增删改 / 扫描 / 刮削都在抽屉里，抽屉任何变更都让首页重拉一次。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CollectionIcon, RefreshIcon } from 'tdesign-icons-vue-next'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import { useFileConnections } from '@/hooks/UseFileConnections'
import type { FileConnection } from '@common/types/file'
import LibraryCard from './components/LibraryCard.vue'
import MediaWallCard from '../components/MediaWallCard.vue'
import { openLibraryDrawer } from '../library/components/LibraryDrawer'
import { useMediaHome } from './composables/useMediaHome'
import { formatTime } from '@/utils/format'

const router = useRouter()
const keyword = ref('')

const { connections, refresh: refreshConnections } = useFileConnections()
const { libraries, rows, loading, failure, total, scrapedCount, indexedAt, load } = useMediaHome()

/** 整排为空就不渲染这一排（主进程给的排可能还没有内容） */
const visibleRows = computed(() => rows.value.filter((row) => row.items.length > 0))

const summary = computed(() => {
  const indexed = indexedAt.value > 0 ? ` · 索引更新于 ${formatTime(indexedAt.value)}` : ''
  return `共 ${total.value} 部 · 已刮削 ${scrapedCount.value} 部 · ${libraries.value.length} 个资料库${indexed}`
})

function connectionOf(connectionId: string): FileConnection | null {
  return connections.value.find((connection) => connection.id === connectionId) ?? null
}

/** 首页搜索 = 跳去「全部影片」并带上关键词；筛选口径由内容页负责 */
function onSearch(): void {
  const text = keyword.value.trim()
  void router.push({
    name: '影视墙资料库',
    query: text.length > 0 ? { libraryId: '', keyword: text } : { libraryId: '' }
  })
}

function goAll(): void {
  void router.push({ name: '影视墙资料库', query: { libraryId: '' } })
}

function openDrawer(): void {
  openLibraryDrawer({ onChanged: () => void load() })
}

onMounted(() => {
  void refreshConnections()
  void load()
})
</script>
<style scoped lang="less">
.media-home {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.home-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.home-search {
  width: 320px;
}

.home-summary {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.home-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.row-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.row-title {
  font-size: 14px;
  color: var(--td-text-color-primary);
}

.row-count {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.row-scroll {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding-bottom: 6px;

  :deep(.media-card) {
    flex: 0 0 180px;
  }
}
</style>
