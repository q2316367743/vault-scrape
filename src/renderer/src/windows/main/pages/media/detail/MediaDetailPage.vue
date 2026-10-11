<template>
  <sub-page-layout :title="description">
    <template #extra>
      <t-button variant="outline" :loading="loading" @click="load">
        <template #icon><refresh-icon /></template>
        重新读取
      </t-button>
      <t-tooltip v-if="detail" content="清掉刮削数据，并把文件还原成刮削前的名字与位置">
        <t-button variant="outline" theme="danger" :loading="clearing" @click="onClearNfo">
          <template #icon><rollback-icon /></template>
          还原刮削前
        </t-button>
      </t-tooltip>
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
<script setup lang="ts">
/**
 * 影片详情页（`/media/detail`）：播放 + 磁盘上的事实 + NFO 元信息。
 *
 * 契约：
 * - 参数只从路由 query 读（`itemId`）：可以直接刷新、也可以重复进入；
 * - 除「还原刮削前」（通道仍是 `media:clear-nfo`）外只读：不下载、不触发刮削、不改索引；取数一律走 mediaApi，失败只提示并允许重试；
 * - 「还原刮削前」用于一键还原成刮削前的样子：二次确认后由主进程删掉刮削数据与磁盘 NFO，
 *   按 NFO 里记的「刮削前位置」把视频改回原名、移回原目录，本地图片搬回原处，刮削下载的
 *   图片 / 预告片删掉；目标已存在时保持现状、不覆盖，演员档案不受影响；清完重新读取详情，不自动重刮；
 * - NSFW 保护按「全局开关 + 该存储 nsfw 标记 + 所属资料库的 nsfwProtection」判定，任一命中即遮罩；
 * - 播放地址只用主进程给的 `playUrl`（`storage://`），渲染层不拼磁盘路径；
 *   返回按钮由 SubPageLayout 提供，本页不要在 `#extra` 里再放一个。
 */
import { computed, onMounted, ref } from 'vue'
import { FilmIcon, RefreshIcon, RollbackIcon } from 'tdesign-icons-vue-next'
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

/** 还原这部影片的刮削成果：先二次确认，清完重新读取详情 */
async function onClearNfo(): Promise<void> {
  if (!detail.value) return
  try {
    await MessageBoxUtil.confirm(
      '这部影片会还原成刮削前的样子：刮削数据（标题、简介、分类、封面与参演名单）清空，磁盘上的 NFO 与刮削下载的图片、预告片一并删掉，视频改回原来的文件名；刮削时挪动过文件的话，还会搬回原来的位置。原来的位置已经有同名文件时保持现状、不覆盖。演员档案不受影响，之后不会自动重新刮削。确定还原？',
      '还原刮削前',
      { confirmButtonText: '还原' }
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
  const { removedNfo, removedAssets, restoredAssets, restored, removedDir } = result.data
  const parts = ['已清除刮削数据']
  parts.push(
    restored
      ? '视频已改回原文件名并移回原位置'
      : '视频保持当前位置（NFO 里没有可用的还原记录，或原位置已被占用）'
  )
  if (removedNfo.length > 0) parts.push(`删掉 ${removedNfo.length} 个 NFO 文件`)
  if (removedAssets.length > 0) parts.push(`删掉 ${removedAssets.length} 个刮削下载的图片 / 预告片`)
  if (restoredAssets.length > 0) parts.push(`${restoredAssets.length} 张本地图片已搬回原位置`)
  if (removedDir.length > 0) parts.push('已删掉搬空的影片目录')
  MessageUtil.success(parts.join('，'))
  await load()
}

onMounted(() => {
  void refresh()
  void load()
})
</script>

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
