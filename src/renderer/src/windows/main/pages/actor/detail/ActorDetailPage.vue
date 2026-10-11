<template>
  <sub-page-layout
    title="演员详情"
    :description="description"
    fallback="/actor"
  >
    <template #extra>
      <t-button variant="outline" :loading="scraping" @click="onScrape">
        <template #icon><user-add-icon /></template>
        抓取资料
      </t-button>
      <t-button v-if="actor" variant="outline" @click="onEdit">
        <template #icon><edit-icon /></template>
        编辑资料
      </t-button>
      <t-button v-if="actor" variant="outline" theme="danger" @click="onRemove">
        <template #icon><delete-icon /></template>
        删除演员
      </t-button>
    </template>

    <div class="actor-detail">
      <t-alert v-if="failure" theme="error" :message="failure" />

      <t-loading v-if="loading && !detail" size="small" text="正在读取演员资料…" />

      <template v-else-if="detail">
        <actor-profile-block :actor="detail.actor" />

        <actor-gallery-block :actor="detail.actor" @changed="load" />

        <section class="films-block">
          <h4 class="block-title">出演作品（{{ detail.films.length }}）</h4>
          <div v-if="detail.films.length > 0" class="films-grid">
            <media-wall-card
              v-for="film in detail.films"
              :key="film.itemId"
              :item="film"
              :connection="connectionOf(film.connectionId)"
            />
          </div>
          <t-empty v-else description="这位演员还没有关联到任何影片" />
        </section>
      </template>

      <t-empty v-else-if="!failure" description="没有读到这位演员的资料" />
    </div>
  </sub-page-layout>
</template>

<script setup lang="ts">
/**
 * 演员详情页（`/actor/detail?actorId=…`）：资料 + 头像图集 + 全部出演作品。
 *
 * 契约：
 * - 参数只从路由 query 读（`actorId`），可以直接刷新、重复进入；
 * - 「抓取资料」把当前所有启用的插件交给主进程，由主进程按顺序试、命中即止；
 * - 出演作品用影视墙的卡片渲染，点进影片详情；连接信息从 `useFileConnections` 反查；
 * - 返回按钮由 SubPageLayout 提供，本页不在 `#extra` 里再放。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { DeleteIcon, EditIcon, UserAddIcon } from 'tdesign-icons-vue-next'
import SubPageLayout from '@/components/PageLayout/SubPageLayout.vue'
import MediaWallCard from '@/components/media/MediaWallCard.vue'
import { useFileConnections } from '@/hooks/UseFileConnections'
import { MessageBoxUtil, MessageUtil } from '@/utils/modal'
import { actorApi, pluginApi } from '@/api'
import type { FileConnection } from '@common/types/file'
import ActorProfileBlock from './components/ActorProfileBlock.vue'
import ActorGalleryBlock from './components/ActorGalleryBlock.vue'
import { useActorDetail } from './composables/useActorDetail'
import { openActorEditorDialog } from '../modals/ActorEditorDialog'

const router = useRouter()
const { actorId, detail, loading, failure, load } = useActorDetail()
const { connections, refresh } = useFileConnections()

const actor = computed(() => detail.value?.actor ?? null)
const description = computed(() => actor.value?.name ?? actorId)
const scraping = ref(false)

function connectionOf(connectionId: string): FileConnection | null {
  return connections.value.find((connection) => connection.id === connectionId) ?? null
}

function onEdit(): void {
  if (!actor.value) return
  openActorEditorDialog({ actor: actor.value, onSaved: () => void load() })
}

/** 抓取前先问插件列表：只有启用中的插件才有机会命中，禁用的不传下去 */
async function onScrape(): Promise<void> {
  if (!actor.value) return
  scraping.value = true
  const plugins = await pluginApi.list()
  if (!plugins.ok) {
    scraping.value = false
    MessageUtil.error(plugins.message)
    return
  }
  const pluginIds = plugins.data.filter((item) => item.enabled).map((item) => item.id)
  const result = await actorApi.scrape({ actorId: actor.value.actorId, pluginIds })
  scraping.value = false
  if (!result.ok) {
    MessageUtil.error(result.message)
    return
  }
  MessageUtil.info(result.data.message)
  await load()
}

async function onRemove(): Promise<void> {
  if (!actor.value) return
  try {
    await MessageBoxUtil.confirm(
      '演员资料、别名、图片与出演关联都会被删除，影片本身不受影响，确定删除？',
      '删除演员'
    )
  } catch {
    return
  }
  const result = await actorApi.remove({ actorId: actor.value.actorId })
  if (!result.ok) {
    MessageUtil.error(result.message)
    return
  }
  MessageUtil.success('已删除演员')
  await router.replace('/actor')
}

onMounted(() => {
  void refresh()
  void load()
})
</script>

<style scoped lang="less">
.actor-detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.films-block {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.block-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--td-text-color-primary);
}

.films-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}
</style>
