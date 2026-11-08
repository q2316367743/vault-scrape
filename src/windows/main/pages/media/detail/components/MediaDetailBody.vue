<template>
  <div class="detail-body">
    <t-alert v-if="failure.length > 0" theme="error" :message="failure" />

    <media-translation-bar
      v-if="hasTranslation"
      :showing="showingTranslation"
      :language="translationLanguage"
      :busy="translationBusy"
      @change="emit('translate', $event)"
      @clear="emit('clearTranslation')"
    />

    <section class="detail-section">
      <media-play-bar :hint="playHint" :disabled="playUrl.length === 0" @play="emit('play')" />
    </section>

    <media-episode-list :seasons="seasons" :active-id="activeId" @select="onSelect" />

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
      <section v-if="infoCells.length > 0" class="detail-section">
        <h4 class="section-title">{{ infoTitle }}</h4>
        <media-fact-grid :cells="infoCells" />
      </section>
      <section class="detail-section">
        <h4 class="section-title">文件信息</h4>
        <media-fact-grid :cells="fileCells" />
      </section>
    </div>

    <media-still-wall :images="stillImages" :protect="protect" />

    <media-actor-strip v-if="detail.actors.length > 0" :actors="detail.actors" />
  </div>
</template>
<script setup lang="ts">
/**
 * 详情页正文：播放条 + 选集 + 剧情简介 + 封面块 + 影片 / 文件信息 + 剧照墙 + 演员条。
 *
 * 契约：
 * - 纯展示：所有取值由 `useDetailView` 在上层算好后按 props 递进来，本组件不取数、不发请求；
 * - 「原文 / 译文」切换条只在**这个条目有译文**时出现（`hasTranslation`），没有译文就不占位；
 *   切换与清除都只 `emit`，落库与重读留在页面；
 * - 与头部（`MediaDetailHero`）分开的原因只有一个——详情页单文件贴着 300 行上限（RL-05），
 *   正文是最大的一块，拆出来之后页面才有余量承载后续功能；
 * - 正文左右内边距在这里（20px），页面容器不再重复给，头部因此天然通栏；
 * - 动作只 `emit`：播放与选集都由页面决定后果。
 */
import type { MediaDetailImage, MediaDetailResult, MediaEpisodeRef, MediaSeasonRef } from '@common/types/media'
import MediaEpisodeList from '@/components/media/MediaEpisodeList.vue'
import SensitiveImage from '@/components/SensitiveImage.vue'
import type { DetailCell } from '../mediaDetailCells'
import MediaActorStrip from './MediaActorStrip.vue'
import MediaFactGrid from './MediaFactGrid.vue'
import MediaPlayBar from './MediaPlayBar.vue'
import MediaStillWall from './MediaStillWall.vue'
import MediaTranslationBar from './MediaTranslationBar.vue'

defineProps<{
  /** 本条详情：封面块与演员条直接用它的 item / actors */
  detail: MediaDetailResult
  /** 读取失败的一句话结论，空串表示没有失败 */
  failure: string
  /** NSFW 遮罩口径（封面块用） */
  protect: boolean
  /** 主进程给的季与集（只含能播的集），影片是空数组 */
  seasons: MediaSeasonRef[]
  /** 当前选中的集 ID，空串表示还没选 */
  activeId: string
  /** 播放地址，空串表示没有源 */
  playUrl: string
  /** 播放按钮点不动时的原因，有源时是空串 */
  playHint: string
  /** 剧情简介，空串时整块不渲染 */
  plot: string
  posterUrl: string
  posterTitle: string
  posterNote: string
  /** 这条记录是整部剧集 */
  isSeries: boolean
  /** 「影片信息」/「剧集信息」区块的标题 */
  infoTitle: string
  infoCells: DetailCell[]
  fileCells: DetailCell[]
  stillImages: MediaDetailImage[]
  /** 这个条目有译文：显示「原文 / 译文」切换条 */
  hasTranslation: boolean
  /** 现在显示的是译文 */
  showingTranslation: boolean
  /** 译文语言的中文名 */
  translationLanguage: string
  /** 翻译 / 清除译文进行中 */
  translationBusy: boolean
}>()

const emit = defineEmits<{
  play: []
  select: [itemId: string]
  /** 切换「原文 / 译文」 */
  translate: [showing: boolean]
  /** 丢掉这条译文 */
  clearTranslation: []
}>()

/** 选集：转成页面认的那一种载荷 */
function onSelect(itemId: MediaEpisodeRef['itemId']): void {
  emit('select', itemId)
}
</script>

<style scoped lang="less">
.detail-body {
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin-top: 20px;
  padding: 0 20px 20px;
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
