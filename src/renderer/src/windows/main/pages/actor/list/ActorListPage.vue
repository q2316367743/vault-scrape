<template>
  <page-layout
    title="演员"
    description="演员档案与图集，点卡片进详情看全部出演作品。"
  >
    <template #extra>
      <t-button variant="outline" :loading="scraping" @click="onScrapeMissing">
        <template #icon><user-add-icon /></template>
        补全缺失资料
      </t-button>
      <t-button theme="primary" @click="onCreate">
        <template #icon><add-icon /></template>
        新增演员
      </t-button>
    </template>

    <div class="actor-list">
      <div class="actor-filters">
        <t-input
          v-model="keyword"
          class="filter-keyword"
          clearable
          placeholder="搜索姓名或别名，回车开始"
          @enter="search"
          @clear="search"
        >
          <template #prefix-icon><search-icon /></template>
        </t-input>
        <t-select
          class="filter-select"
          :model-value="sort"
          :options="sortOptions"
          placeholder="排序"
          @change="onSortChange"
        />
        <t-select
          class="filter-select"
          :model-value="tag"
          :options="tagOptions"
          placeholder="全部标签"
          clearable
          @change="onTagChange"
        />
        <t-select
          class="filter-select"
          :model-value="limit"
          :options="limitOptions"
          @change="onLimitChange"
        />
        <t-button variant="outline" :loading="loading" @click="load">
          <template #icon><refresh-icon /></template>
          刷新
        </t-button>
      </div>

      <t-alert v-if="failure" theme="error" :message="failure" />

      <t-loading v-if="loading && list.length === 0" size="small" text="正在读取演员…" />

      <div v-else-if="list.length > 0" class="actor-grid">
        <actor-card
          v-for="item in list"
          :key="item.actorId"
          :actor="item"
          @select="onSelect"
        />
      </div>

      <t-empty
        v-else-if="!failure"
        description="还没有演员，先新增一位，或者去影视详情页把参演演员挂上"
      />

      <div v-if="total > limit" class="actor-pager">
        <t-pagination
          v-model="page"
          :total="total"
          :page-size="limit"
          @current-change="load"
        />
      </div>
    </div>
  </page-layout>
</template>

<script setup lang="ts">
/**
 * 演员列表页（`/actor`）：关键词 / 标签 / 排序 / 分页 + 新增 + 批量补全缺失资料。
 *
 * 契约：
 * - 取数一律走 `@/api` 的 actorApi；条件变化回第一页，翻页保持条件；
 * - 「补全缺失资料」把缺头像、缺生日或从未刮削过的演员排队给插件补，队列在主进程串行执行；
 * - 编辑在详情页做，这里点卡片只跳转。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AddIcon, RefreshIcon, SearchIcon, UserAddIcon } from 'tdesign-icons-vue-next'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import { MessageUtil } from '@/utils/modal'
import { actorApi } from '@/api'
import { ACTOR_PAGE_SIZES, ACTOR_SORTS, ACTOR_SORT_LABELS } from '@common/types/actor'
import ActorCard from '../components/ActorCard.vue'
import { useActorList } from './composables/useActorList'
import { openActorEditorDialog } from '../modals/ActorEditorDialog'

const router = useRouter()
const { list, tags, total, keyword, tag, sort, limit, page, loading, failure, load, search } =
  useActorList()

const scraping = ref(false)

const sortOptions = ACTOR_SORTS.map((value) => ({ value, label: ACTOR_SORT_LABELS[value] }))
const limitOptions = ACTOR_PAGE_SIZES.map((value) => ({ value, label: `每页 ${value} 位` }))
const tagOptions = computed(() => tags.value.map((value) => ({ value, label: value })))

function onSelect(actorId: string): void {
  void router.push({ name: '演员详情', query: { actorId } })
}

function onCreate(): void {
  openActorEditorDialog({ onSaved: () => void search() })
}

async function onScrapeMissing(): Promise<void> {
  scraping.value = true
  const result = await actorApi.scrapeMissing()
  scraping.value = false
  if (!result.ok) {
    MessageUtil.error(result.message)
    return
  }
  const queued = result.data.queued
  MessageUtil.info(queued > 0 ? `${result.data.message}，进度见概览页` : result.data.message)
  await load()
}

onMounted(() => {
  void load()
})

/** t-select 的 change 载荷是宽类型，这里收窄回 ActorSort 再写进查询条件 */
function onSortChange(value: unknown): void {
  const matched = ACTOR_SORTS.find((item) => item === value)
  if (matched) {
    sort.value = matched
    void search()
  }
}

function onTagChange(value: unknown): void {
  tag.value = typeof value === 'string' ? value : ''
  void search()
}

function onLimitChange(value: unknown): void {
  if (typeof value === 'number' && value > 0) {
    limit.value = value
    void search()
  }
}
</script>

<style scoped lang="less">
.actor-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.actor-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.filter-keyword {
  width: 260px;
}

.filter-select {
  width: 140px;
}

.actor-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}

.actor-pager {
  display: flex;
  justify-content: flex-end;
}
</style>
