<template>
  <sub-page-layout :title="pageTitle" fallback="/media" :description="pageDescription">
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
        />
      </div>

      <t-empty
        v-else-if="!failure"
        :title="emptyTitle"
        :description="`点上方「资料库」扫描后，${noun}会自动出现在这里`"
      />
    </div>
  </sub-page-layout>
</template>
<script setup lang="ts">
/**
 * 影视墙内容页：一个资料库（或全部资料库）里的**墙面条目**——影视库放影片、剧集库放剧集。
 *
 * 契约：
 * - 文案跟着库类型走（`影片` / `剧集`）：库类型来自 `libraryApi.list()` 的同一次查询，
 *   拿不到时按影视库说（全部资料库混在一起时没有单一类型，用中性的「部 / 内容」）；
 * - 库由路由 query 决定：`/media/library?libraryId=<id>`，空串表示「全部影片」；
 *   首页的搜索也会把 `keyword` 带过来，作为搜索框初值；
 * - 过滤与排序都在渲染层（见 useMediaWall），资料库的增删改与扫描 / 刮削在抽屉里，
 *   抽屉里任何变更都让本页重拉一次，保证计数与卡片同步；
 * - 卡片的 NSFW 遮罩由卡片自己按库级 `nsfwProtection` 判定，本页不参与。
 */
import { RefreshIcon } from 'tdesign-icons-vue-next'
import { libraryApi } from '@/api'
import SubPageLayout from '@/components/PageLayout/SubPageLayout.vue'
import type { LibraryType } from '@common/types/library'
import MediaWallCard from '@/components/media/MediaWallCard.vue'
import { useMediaWall } from './composables/useMediaWall'
import { formatTime } from '@/utils/format'

interface WallOption {
  value: string
  label: string
}

const SORT_OPTIONS: WallOption[] = [
  { value: 'title', label: '按标题' },
  { value: 'size', label: '按体积' },
  { value: 'modified', label: '按修改时间' }
]

const route = useRoute()

function queryText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

const libraryId = ref(queryText(route.query.libraryId))
const libraryName = ref('')
/** 库类型只影响文案（影片 / 剧集），与 `libraryApi.list()` 的同一次查询一起取回 */
const libraryType = ref<LibraryType>('movie')

const { loading, failure, indexedAt, keyword, sort, visible, load } = useMediaWall(libraryId)

keyword.value = queryText(route.query.keyword)

/** `noun` 按库类型给「影片」/「剧集」，用于标题、描述与空态文案 */
const noun = computed(() => (libraryType.value === 'tv' ? '剧集' : '影片'))

const pageTitle = computed(() => {
  if (libraryId.value.length === 0) return '影视墙'
  return libraryName.value.length > 0 ? libraryName.value : '资料库'
})

const pageDescription = computed(
  () => `资料库里的${noun.value}聚成一堵墙，标题与封面来自刮削`
)

const emptyTitle = computed(() => {
  if (libraryId.value.length === 0) return '墙上还没有内容'
  return `这个资料库还没有${noun.value}`
})

const summary = computed(() => {
  const indexed = indexedAt.value > 0 ? ` · 最近扫描 ${formatTime(indexedAt.value)}` : ''
  return `共 ${visible.value.length} 部${indexed}`
})

function onSortChange(value: unknown): void {
  if (value === 'title' || value === 'size' || value === 'modified') {
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
  const found = result.data.find((library) => library.id === libraryId.value) ?? null
  libraryName.value = found?.name ?? ''
  libraryType.value = found?.type ?? 'movie'
}

watch(
  () => route.query.libraryId,
  (value) => {
    libraryId.value = queryText(value)
    void loadLibraryName()
  }
)

onMounted(() => {
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
