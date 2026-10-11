<script setup lang="ts">
/**
 * 影片详情页（`/media/detail`）：播放 + 磁盘上的事实 + NFO 元信息。
 *
 * 契约：
 * - 参数只从路由 query 读（`itemId`）：可以直接刷新、也可以重复进入；
 * - 除「清除 NFO」外只读：不下载、不触发刮削、不改索引；取数一律走 mediaApi，失败只提示并允许重试；
 * - 「清除 NFO」用于清掉错误的刮削成果：二次确认后由主进程删掉这条影片的刮削数据与磁盘 NFO，
 *   视频、图片文件与演员档案不受影响；清完重新读取详情，不自动重刮；
 * - NSFW 保护按「全局开关 + 该存储 nsfw 标记 + 所属资料库的 nsfwProtection」判定，任一命中即遮罩；
 * - 播放地址只用主进程给的 `playUrl`（`storage://`），渲染层不拼磁盘路径；
 *   返回按钮由 SubPageLayout 提供，本页不要在 `#extra` 里再放一个。
 */
import { computed, onMounted, ref } from 'vue'
import { DeleteIcon, FilmIcon, RefreshIcon } from 'tdesign-icons-vue-next'
import { mediaApi } from '@/api/media'
import SubPageLayout from '@/components/PageLayout/SubPageLayout.vue'
import SensitiveImage from '@/components/SensitiveImage.vue'
import MediaPlayer from '@/components/media/MediaPlayer.vue'
import { useFileConnections } from '@/hooks/UseFileConnections'
import { useNsfwProtection } from '@/hooks/UseNsfwProtection'
import { MessageBoxUtil, MessageUtil } from '@/utils/modal'
import MediaFactGrid from './components/MediaFactGrid.vue'
import MediaNfoBlock from './components/MediaNfoBlock.vue'
import MediaActorStrip from './components/MediaActorStrip.vue'
import { useMediaDetail } from './composables/useMediaDetail'
import { fileCells } from './mediaDetailCells'

const { itemId, detail, loading, failure, load } = useMediaDetail()
const { connections, refresh } = useFileConnections()

/** 连接归属从详情结果反查：路由只带影片身份，不带路径 */
const connection = computed(() => {
  const id = detail.value?.item.connectionId
  if (id === undefined || id.length === 0) return null
  return connections.value.find((item) => item.id === id) ?? null
})
const { active } = useNsfwProtection(connection)
/** 全局开关 + 存储标记命中，或所属资料库自己要求按敏感内容处理 */
const protect = computed(() => active.value || detail.value?.item.nsfwProtected === true)
const sourceName = computed(() => connection.value?.name ?? '')
const factCells = computed(() => (detail.value ? fileCells(detail.value, sourceName.value) : []))
/** 页头描述：读到详情后显示标题，否则退化成影片 ID */
const description = computed(() => detail.value?.item.title ?? itemId)

const clearing = ref(false)

/** 清除这部影片的刮削成果：先二次确认，清完重新读取详情 */
async function onClearNfo(): Promise<void> {
  if (!detail.value) return
  try {
    await MessageBoxUtil.confirm(
      '这部影片的刮削数据（标题、简介、分类、封面与参演名单）会被清空，磁盘上的 NFO 文件会被删除，之后不会自动重新刮削。视频与图片文件保留，演员档案不受影响，确定清除？',
      '清除 NFO',
      { confirmButtonText: '清除' }
    )
  } catch {
    return
  }
  clearing.value = true
  const result = await mediaApi.clearNfo({ itemId: detail.value.item.itemId })
  clearing.value = false
  if (!result.ok) {
    MessageUtil.error(result.message)
    return
  }
  const removed = result.data.removedNfo.length
  MessageUtil.success(
    removed > 0 ? `已清除刮削数据，并删除 ${removed} 个 NFO 文件` : '已清除刮削数据（磁盘上没有 NFO 文件）'
  )
  await load()
}

onMounted(() => {
  void refresh()
  void load()
})
</script>

<template>
  <sub-page-layout title="影片详情" :description="description">
    <template #extra>
      <t-button variant="outline" :loading="loading" @click="load">
        <template #icon><refresh-icon /></template>
        重新读取
      </t-button>
      <t-button
        v-if="detail"
        variant="outline"
        theme="danger"
        :loading="clearing"
        @click="onClearNfo"
      >
        <template #icon><delete-icon /></template>
        清除 NFO
      </t-button>
    </template>

    <div class="media-detail">
      <t-alert v-if="failure" theme="error" :message="failure" />

      <t-loading v-if="loading && !detail" size="small" text="正在读取影片信息…" />

      <template v-else-if="detail">
        <media-player
          v-if="detail.item.playUrl"
          :url="detail.item.playUrl"
          :poster="detail.item.coverUrl"
          :protect="protect"
        />
        <t-alert
          v-else
          theme="warning"
          message="没有找到这个影片的播放地址，请回影视墙刷新后再试"
        />

        <section class="detail-block overview">
          <sensitive-image
            v-if="detail.item.coverUrl"
            class="overview-cover"
            :src="detail.item.coverUrl"
            :protect="protect"
            :width="200"
            :height="280"
            alt="影片封面"
            fit="cover"
          />
          <div v-else class="overview-cover is-empty">
            <film-icon size="32px" />
            <span>没有找到封面</span>
          </div>

          <div class="overview-facts">
            <h4 class="block-title">磁盘上的事实</h4>
            <media-fact-grid :cells="factCells" />
          </div>
        </section>

        <media-actor-strip v-if="detail.actors.length > 0" :actors="detail.actors" />

        <media-nfo-block :detail="detail" />
      </template>

      <t-empty v-else-if="!failure" description="还没有影片信息" />
    </div>
  </sub-page-layout>
</template>

<style scoped lang="less">
.media-detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.overview {
  flex-direction: row;
  align-items: flex-start;
  gap: 16px;
}

.overview-cover {
  flex-shrink: 0;
}

.overview-cover.is-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 200px;
  height: 280px;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
  background-color: var(--td-bg-color-container-hover);
  border-radius: var(--td-radius-default);
}

.overview-facts {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.block-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--td-text-color-primary);
}
</style>
