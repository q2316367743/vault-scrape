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
      @translate="onTranslate"
    />

    <template v-if="view">
      <media-detail-hero :detail="view" :protect="protect" />
      <div ref="heroEnd" class="hero-end" aria-hidden="true"></div>

      <media-detail-body
        :detail="view"
        :failure="failure"
        :protect="protect"
        :seasons="seasons"
        :active-id="activeId"
        :play-url="playUrl"
        :play-hint="playHint"
        :plot="plot"
        :poster-url="posterUrl"
        :poster-title="posterTitle"
        :poster-note="posterNote"
        :is-series="isSeries"
        :info-title="infoTitle"
        :info-cells="infoCells"
        :file-cells="fileCells"
        :still-images="stillImages"
        :has-translation="hasTranslation"
        :showing-translation="showing"
        :translation-language="languageLabel"
        :translation-busy="translating"
        @play="onPlay"
        @select="select"
        @translate="setShowTranslation"
        @clear-translation="onClearTranslation"
      />
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
 * 影片详情页（`/media/detail`）：沉浸头部 + 正文（播放 / 选集 / 剧情 / 封面 / 信息 / 剧照 / 演员）。
 *
 * 契约：
 * - 参数只从路由 query 读（`itemId`）：可以直接刷新、也可以重复进入；
 * - **元信息全部来自本地库**（`media_item` 的刮削列，刮削与扫描都会写）：进页面只查一次库，
 *   不再为标题 / 片商这类信息去读磁盘 NFO，所以重复进入不会再有磁盘与网络往返；
 *   页面上也不出现「NFO」「磁盘」这类实现词，只按用户视角分「影片信息」与「文件信息」两块；
 * - 除「还原刮削前」（通道仍是 `media:clear-nfo`）与「翻译」（通道是 `translate:item`）外只读：
 *   不下载、不触发刮削、不改索引；取数一律走 mediaApi，失败只提示并允许重试；
 * - **不用 `SubPageLayout`**：没有页头横条，返回与「更多」（重新读取 / 还原刮削前）都浮在封面图上，
 *   由 `MediaDetailToolbar` 提供；代价是本页要自己做滚动容器（根节点 `height: 100%` + `overflow: auto`），
 *   正文的版式与内边距落在 `components/MediaDetailBody.vue`（本页贴着 300 行上限，正文整块拆了出去）；
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
 * - 「翻译」也在「更多」里，且**不受设置里的翻译开关影响**：弹窗列出全部翻译插件（不可用的置灰并给原因），
 *   用户选一个后由主进程翻这条影视（剧集连每集简介一起翻），成功后重读详情；译文只在库里，
 *   界面通过「原文 / 译文」切换条查看，**原文、文件名与磁盘 NFO 都不动**；
 * - NSFW 保护按「全局开关 + 所属资料库的 nsfwProtection」判定，命中即遮罩；头部给**模糊底图**、点一下看原图，封面与剧照逐张遮罩；
 * - 播放地址只用主进程给的 `playUrl`（`storage://`）判断「有没有源」，渲染层不拼磁盘路径、也不自己播；
 *   剧集播的是「选中的那一集」（默认第一集、重读后回落第一集）。
 */
import { computed, onMounted, ref, useTemplateRef } from 'vue'
import { mediaApi, playerApi, translateApi } from '@/api'
import { useEpisodeSelection } from '@/hooks/UseEpisodeSelection'
import { useFileConnections } from '@/hooks/UseFileConnections'
import { MessageBoxUtil, MessageUtil } from '@/utils/modal'
import { useTranslatePlugins } from '@/windows/main/composables/useTranslatePlugins'
import MediaDetailBody from './components/MediaDetailBody.vue'
import MediaDetailHero from './components/MediaDetailHero.vue'
import MediaDetailToolbar from './components/MediaDetailToolbar.vue'
import { useDetailScroll } from './composables/useDetailScroll'
import { useDetailView } from './composables/useDetailView'
import { useManualMatch } from './composables/useManualMatch'
import { useMediaDetail } from './composables/useMediaDetail'
import { useTranslationView } from './composables/useTranslationView'
import { translatedDetail } from './mediaDetailCells'
import { openTranslateDialog } from './modals/TranslateDialog'

const { itemId, detail, loading, failure, load } = useMediaDetail()
const { connections, refresh } = useFileConnections()
/** 「原文 / 译文」开关：有译文才谈得上切，切了整页字段一起换 */
const { hasTranslation, showing, languageLabel, setShowTranslation } = useTranslationView(detail)
/** 界面实际渲染的详情：切到译文时换成译文，没有译文的位置回落原文 */
const view = computed(() => (detail.value ? translatedDetail(detail.value, showing.value) : null))
/** 展示口径（连接反查 / 保护判定 / 封面块 / 剧照墙 / 两个信息区块）都在这里 */
const {
  protect,
  isSeries,
  fileCells,
  infoCells,
  infoTitle,
  stillImages,
  plot,
  posterUrl,
  posterTitle,
  posterNote,
  noSourceHint
} = useDetailView(view, connections)
/** 剧集：播哪一集由选集状态决定（影片没有集时回落条目自己） */
const { seasons, activeId, playUrl, select } = useEpisodeSelection(view)
/** 手动匹配：开窗搜候选，应用成功后重读详情 */
const { open: onManualMatch } = useManualMatch(detail, protect)

const clearing = ref(false)
const translating = ref(false)
/** 翻译插件的候选与状态：与设置页共用同一份来源 */
const { plugins, state, load: loadTranslatePlugins } = useTranslatePlugins()

/** 播放入口的说明：只在「按钮为什么点不动」时给一句原因，有源时不预告任何东西 */
const playHint = computed(() => (playUrl.value.length === 0 ? noSourceHint.value : ''))

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

/**
 * 「更多 → 翻译」：**不受设置里的翻译开关影响**，永远给入口，按插件的实际情况分别给结论。
 *
 * 四种情况分开说，是因为用户接下来要做的事完全不同：一个插件都没有要去添加、有插件但都没启用
 * 要去启用、有启用的但都不可用要去补设置；只有至少一个能用时才值得开弹窗选插件。
 */
async function onTranslate(): Promise<void> {
  if (itemId.length === 0 || translating.value) return
  translating.value = true
  try {
    await loadTranslatePlugins()
  } finally {
    translating.value = false
  }
  if (state.value === 'empty') {
    MessageUtil.warning('没有翻译插件，请先到插件页添加')
    return
  }
  if (state.value === 'disabled') {
    MessageUtil.warning('翻译插件都没有启用，请先到插件页启用')
    return
  }
  if (state.value === 'unusable') {
    MessageUtil.warning('翻译插件都需要先补全设置，请到插件页填写')
    return
  }
  openTranslateDialog({
    itemId,
    plugins: plugins.value,
    isSeries: isSeries.value,
    onApplied: () => {
      void load()
    }
  })
}

/** 清除这条译文：只删译文这份派生物，原文与磁盘文件都不动，所以不必二次确认 */
async function onClearTranslation(): Promise<void> {
  if (itemId.length === 0 || translating.value) return
  translating.value = true
  const result = await translateApi.clear({ itemId })
  translating.value = false
  if (!result.ok) {
    MessageUtil.error(result.message)
    return
  }
  MessageUtil.success(result.data.removed ? '已清除译文' : '这条影视没有译文')
  await load()
}

onMounted(() => {
  void refresh()
  void load()
})
</script>

<style scoped lang="less">
/* 没有页头横条，本页自己就是滚动容器；头部通栏，正文的内边距在 `MediaDetailBody` 上 */
.media-detail {
  height: 100%;
  overflow: auto;
}

/* 头部正下方的哨兵：不占地方，只给 `IntersectionObserver` 当靶子 */
.hero-end {
  height: 1px;
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
</style>
