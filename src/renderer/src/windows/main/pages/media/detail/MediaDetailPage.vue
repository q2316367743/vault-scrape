<template>
  <div ref="scrollBox" class="media-detail">
    <media-detail-toolbar
      :loaded="detail !== null"
      :busy="loading || clearing"
      :collapsed="collapsed"
      :title="posterTitle"
      @reload="load"
      @restore="onClearNfo"
      @match="onManualMatch"
    />

    <template v-if="detail">
      <media-detail-hero :detail="detail" :protect="protect" />
      <div ref="heroEnd" class="hero-end" aria-hidden="true"></div>

      <div class="detail-body">
        <t-alert v-if="failure" theme="error" :message="failure" />

        <section class="detail-section">
          <media-play-bar :hint="playHint" :disabled="playUrl.length === 0" @play="onPlay" />
        </section>

        <media-episode-list :seasons="seasons" :active-id="activeId" @select="select" />

        <section v-if="plot.length > 0" class="detail-section">
          <h4 class="section-title">剧情简介</h4>
          <p class="plot">{{ plot }}</p>
        </section>

        <section v-if="posterUrl.length > 0" class="detail-poster">
          <sensitive-image
            class="poster-image"
            :src="posterUrl"
            :protect="protect"
            :width="168"
            :height="238"
            :alt="isSeries ? '剧集封面' : '影片封面'"
            fit="cover"
          />
          <span class="poster-title" :title="detail.item.title">{{ posterTitle }}</span>
          <span v-if="posterNote.length > 0" class="poster-note">{{ posterNote }}</span>
        </section>

        <div class="detail-columns">
          <media-nfo-block :detail="detail" />
          <section class="detail-section">
            <h4 class="section-title">磁盘上的事实</h4>
            <media-fact-grid :cells="factCells" />
          </section>
        </div>

        <media-still-wall :images="stillImages" :protect="protect" />

        <media-actor-strip v-if="detail.actors.length > 0" :actors="detail.actors" />
      </div>
    </template>

    <div v-else class="detail-fallback">
      <t-loading v-if="loading" size="small" text="正在读取影片信息…" />
      <t-alert v-else-if="failure" theme="error" :message="failure" />
      <t-empty v-else description="还没有影片信息" />
    </div>
  </div>
</template>
<script setup lang="ts">
/**
 * 影片详情页（`/media/detail`）：沉浸头部 + 播放 + 剧情简介 + 封面 + 元信息 / 磁盘事实 + 剧照墙 + 演员。
 *
 * 契约：
 * - 参数只从路由 query 读（`itemId`）：可以直接刷新、也可以重复进入；
 * - 除「还原刮削前」（通道仍是 `media:clear-nfo`）外只读：不下载、不触发刮削、不改索引；取数一律走 mediaApi，失败只提示并允许重试；
 * - **不用 `SubPageLayout`**：没有页头横条，返回与「更多」（重新读取 / 还原刮削前）都浮在封面图上，
 *   由 `MediaDetailToolbar` 提供；代价是本页要自己做滚动容器（根节点 `height: 100%` + `overflow: auto`），
 *   正文左右内边距也从页头挪到 `.detail-body`（20px），头部因此天然通栏，不再需要负外边距出血；
 * - 悬浮条**吸顶**（`position: sticky`，靠负外边距不占流内空间）：头部的标题被滚出视野后，它退成一条
 *   半透明横幅（毛玻璃 + 单行省略号的标题），判断在 `composables/useDetailScroll.ts`（哨兵 + 相交观察）；
 * - 标题只写在头部一次（大字号压在背景图下缘的渐隐区上），横幅里那份是滚出去之后的替身；
 * - **详情页不再内嵌播放器**：点「播放」调 `playerApi.open()` 打开独立播放窗口（左侧画面、右侧影片详情侧栏）；
 *   本页只负责「选哪一集」，选集区选中的那一集就是播放窗口要播的那一集；
 * - 版式是沉浸式：通栏背景图 + 留白分区，区块不画底板与描边；
 *   区块底色一律不要铺：页面容器（`windows/main/App.vue` 的 `.main-container`）已经是 `--td-bg-color-container`，
 *   只有头部渐隐需要显式取这个 token 才与面板同色（取 `--td-bg-color-page` 会压出色带）；
 * - 「还原刮削前」用于一键还原成刮削前的样子：二次确认后由主进程删掉刮削数据与磁盘 NFO，
 *   按 NFO 记的「刮削前位置」把视频改回原名、移回原目录（剧集连剧集目录一起搬回、逐集还原），
 *   本地图片搬回原处、删掉刮削下载的图片 / 预告片；目标已存在时保持现状、不覆盖；清完重读详情，不自动重刮；
 * - 「手动匹配」在「更多」里打开弹窗：搜候选 → 选一条 → 主进程按这条跑完整刮削流水线（与自动刮削同产物），
 *   应用成功后重新读取详情；可用的刮削器取自所属资料库，NSFW 条目按番号搜、其余按 TMDB ID 或关键字搜；
 * - NSFW 保护按「全局开关 + 该存储 nsfw 标记 + 所属资料库的 nsfwProtection」判定，任一命中即遮罩；头部给**模糊底图**、点一下看原图，封面与剧照逐张遮罩；
 * - 播放地址只用主进程给的 `playUrl`（`storage://`）判断「有没有源」，渲染层不拼磁盘路径、也不自己播；
 *   剧集播的是「选中的那一集」（默认第一集、重读后回落第一集）。
 */
import { computed, onMounted, ref, useTemplateRef } from 'vue'
import { mediaApi, playerApi } from '@/api'
import SensitiveImage from '@/components/SensitiveImage.vue'
import MediaEpisodeList from '@/components/media/MediaEpisodeList.vue'
import { useEpisodeSelection } from '@/hooks/UseEpisodeSelection'
import { useFileConnections } from '@/hooks/UseFileConnections'
import { MessageBoxUtil, MessageUtil } from '@/utils/modal'
import MediaActorStrip from './components/MediaActorStrip.vue'
import MediaDetailHero from './components/MediaDetailHero.vue'
import MediaDetailToolbar from './components/MediaDetailToolbar.vue'
import MediaFactGrid from './components/MediaFactGrid.vue'
import MediaNfoBlock from './components/MediaNfoBlock.vue'
import MediaPlayBar from './components/MediaPlayBar.vue'
import MediaStillWall from './components/MediaStillWall.vue'
import { useDetailScroll } from './composables/useDetailScroll'
import { useDetailView } from './composables/useDetailView'
import { useManualMatch } from './composables/useManualMatch'
import { useMediaDetail } from './composables/useMediaDetail'

const { itemId, detail, loading, failure, load } = useMediaDetail()
const { connections, refresh } = useFileConnections()
/** 展示口径（连接反查 / 保护判定 / 封面块 / 剧照墙 / 信息格）都在这里 */
const {
  protect,
  isSeries,
  factCells,
  stillImages,
  plot,
  posterUrl,
  posterTitle,
  posterNote,
  noSourceHint
} = useDetailView(detail, connections)
/** 剧集：播哪一集由选集状态决定（影片没有集时回落条目自己） */
const { seasons, activeId, playUrl, activeEpisode, select } = useEpisodeSelection(detail)
/** 手动匹配：开窗搜候选，应用成功后重读详情 */
const { open: onManualMatch } = useManualMatch(detail, protect)

const clearing = ref(false)

/** 播放入口的一句话说明：没有源时说清原因，有源时说清「会开新窗口」 */
const playHint = computed(() => {
  if (playUrl.value.length === 0) return noSourceHint.value
  const opening = '点「播放」会在独立窗口里打开：左侧是画面，右侧是影片详情与选集。'
  if (!isSeries.value) return opening
  const episode = activeEpisode.value
  const label = episode ? `第 ${episode.seasonNumber} 季第 ${episode.episodeNumber} 集` : '选中的这一集'
  return `将播放${label}。${opening}`
})

/** 打开播放窗口：剧集把选中的那一集一起带过去，影片只带条目本身 */
function onPlay(): void {
  if (itemId.length === 0 || playUrl.value.length === 0) return
  void playerApi.open({
    itemId,
    ...(activeId.value.length > 0 ? { episodeId: activeId.value } : {})
  })
}

/** 根节点是滚动容器、头部正下方那枚 1px 哨兵用来判断标题有没有滚出视野 */
const scrollBox = useTemplateRef<HTMLElement>('scrollBox')
const heroEnd = useTemplateRef<HTMLElement>('heroEnd')
const collapsed = useDetailScroll(scrollBox, heroEnd)

/** 还原这部影片 / 剧集的刮削成果：先二次确认，清完重新读取详情 */
async function onClearNfo(): Promise<void> {
  if (!detail.value) return
  const isSeries = detail.value.item.type === 'series'
  const subject = isSeries ? '这部剧集' : '这部影片'
  const moved = isSeries
    ? '每一集的视频改回原来的文件名，剧集目录与集文件搬回原来的位置'
    : '视频改回原来的文件名，刮削时挪动过文件的话再搬回原来的位置'
  try {
    await MessageBoxUtil.confirm(
      `${subject}会还原成刮削前的样子：刮削数据（标题、简介、分类、封面与参演名单）清空，磁盘上的 NFO 与刮削下载的图片、预告片一并删掉，${moved}。原来的位置已经有同名文件时保持现状、不覆盖。演员档案不受影响，之后不会自动重新刮削。确定还原？`,
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
  const { removedNfo, removedAssets, restoredAssets, restored, removedDirs } = result.data
  const parts = ['已清除刮削数据']
  parts.push(
    restored
      ? isSeries
        ? '剧集目录与集文件已改回原来的名字与位置'
        : '视频已改回原文件名并移回原位置'
      : '文件保持当前位置（NFO 里没有可用的还原记录，或原位置已被占用）'
  )
  if (removedNfo.length > 0) parts.push(`删掉 ${removedNfo.length} 个 NFO 文件`)
  if (removedAssets.length > 0) parts.push(`删掉 ${removedAssets.length} 个刮削下载的图片 / 预告片`)
  if (restoredAssets.length > 0) parts.push(`${restoredAssets.length} 张本地图片已搬回原位置`)
  if (removedDirs.length > 0) parts.push(`已删掉 ${removedDirs.length} 个搬空的目录`)
  MessageUtil.success(parts.join('，'))
  await load()
}

onMounted(() => {
  void refresh()
  void load()
})
</script>

<style scoped lang="less">
/* 没有页头横条，本页自己就是滚动容器；头部通栏，正文的内边距只在 `.detail-body` 上 */
.media-detail {
  height: 100%;
  overflow: auto;
}

/* 头部正下方的哨兵：不占地方，只给 `IntersectionObserver` 当靶子 */
.hero-end {
  height: 1px;
}

.detail-body {
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin-top: 20px;
  padding: 0 20px 20px;
}

/* 加载 / 失败 / 空态：顶上留出悬浮工具条的位置，下面居中 */
.detail-fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 360px;
  padding: 96px 20px 24px;
}

.detail-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--td-text-color-primary);
}

.plot {
  margin: 0;
  font-size: 14px;
  line-height: 1.9;
  color: var(--td-text-color-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

/* 封面块：头部是模糊底图时给一张清晰的，标题与番号 / 体积在下面收尾 */
.detail-poster {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 168px;
}

.poster-image {
  overflow: hidden;
  border-radius: var(--td-radius-medium);
}

.poster-title {
  overflow: hidden;
  font-size: 13px;
  color: var(--td-text-color-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.poster-note {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.detail-columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 24px;
  align-items: start;
}
</style>
