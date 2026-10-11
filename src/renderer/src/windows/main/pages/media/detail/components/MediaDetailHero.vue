<template>
  <section :class="['detail-hero', { 'is-plain': media.length === 0 }]">
    <div class="hero-media">
      <t-image
        v-if="media.length > 0"
        class="hero-image"
        :class="{ 'is-blurred': blurred }"
        :src="media"
        fit="cover"
        @load="onMediaLoad"
      />
      <div class="hero-scrim"></div>

      <div v-if="masked && media.length > 0" class="hero-mask" @click="revealed = true">
        <t-button class="hero-mask-button" variant="outline" shape="round" size="small">
          <template #icon><browse-icon /></template>
          点击查看原图
        </t-button>
      </div>
    </div>

    <div class="hero-body">
      <h1 class="hero-title">{{ title }}</h1>
      <p v-if="subtitle.length > 0" class="hero-subtitle">{{ subtitle }}</p>

      <div class="hero-bar">
        <t-button
          v-if="detail.item.playUrl"
          class="hero-play"
          theme="primary"
          size="large"
          shape="round"
          @click="emit('play')"
        >
          <template #icon><play-circle-icon /></template>
          播放
        </t-button>

        <div v-if="facts.length > 0" class="hero-facts">
          <span v-for="fact in facts" :key="fact.label" class="hero-fact">
            <span class="hero-fact-label">{{ fact.label }}</span>
            <span class="hero-fact-value">{{ fact.value }}</span>
          </span>
        </div>
      </div>

      <div v-if="tags.length > 0" class="hero-tags">
        <t-tag v-for="tag in tags" :key="tag" size="small" variant="light" theme="primary">
          {{ tag }}
        </t-tag>
      </div>
    </div>
  </section>
</template>
<script setup lang="ts">
/**
 * 详情页的沉浸头部：整幅背景图 + 压在图片下缘渐隐区上的标题 / 原名 + 播放按钮 + 要点行 + 标签。
 *
 * 契约：
 * - 只读详情结果，不取数、不改数据；「播放」只 `emit('play')`，由页面决定滚到播放器还是别处（不自动播放）；
 * - 背景图优先缩略图 / 横幅 / 背景图 / 剧照，都没有才退回封面；退回封面时说明只有一张竖版封面，
 *   此时把封面**模糊放大**当底图，避免 2:3 的图被裁成一条（清晰的那张由页面单独成块展示）；
 * - `protect` 为真时先给**模糊底图**，点一下（`.hero-mask`）才换成清晰原图：既不第一眼就露出敏感画面，
 *   头部又不会只剩一块纯色底；
 * - 选中的图加载完会量一次实际宽高，竖图同样走模糊底图：`backdrop` 里混着 `extrafanart` 的竖版剧照，
 *   光看类型分不出横竖；
 * - 图片带底部渐隐到**内容面板底色**（`--td-bg-color-container`）：标题压在这一段上，不能改用
 *   `--td-bg-color-page`，否则头部底边会与页面容器不同色，像一条横幅盖在标题上；
 * - **分层是硬约束**：`.hero-media` 自己 `z-index: 0` 成层，`.hero-scrim`(1) / `.hero-mask`(2) /
 *   `.hero-body`(1) 都显式写 z-index——tdesign 图片根节点是 `position: relative; z-index: 1`，
 *   父容器不成层叠上下文时它会越过同层兄弟，把标题文字整行盖住；
 * - 没有值的要点不显示，所以未刮削的影片头部不会是一排「—」；
 * - 左右出血由页面负责（本组件只管铺满自己的容器）。
 */
import { computed, ref, watch } from 'vue'
import { BrowseIcon, PlayCircleIcon } from 'tdesign-icons-vue-next'
import type { MediaDetailResult } from '@common/types/media'
import { backdropUrlOf, heroBackdropOf, heroFacts, heroTags } from '../mediaDetailCells'

const props = defineProps<{
  detail: MediaDetailResult
  /** 是否按敏感内容处理：为真时背景图先模糊，点一下才看清 */
  protect: boolean
}>()

const emit = defineEmits<{ play: [] }>()

/** 保护命中时是否还没点开 */
const revealed = ref(false)
/** 选中的图实际是不是横图：加载完成后按原图宽高判定，判定前先按横图处理 */
const landscape = ref(true)

// 详情页是同一个路由换 query，换影片时组件不会重建，这里手动清掉上一部片子的状态
watch(
  () => props.detail.item.itemId,
  () => {
    revealed.value = false
    landscape.value = true
  }
)

const media = computed(() => backdropUrlOf(props.detail))
const masked = computed(() => props.protect && !revealed.value)
/**
 * 三种情况走模糊，只有第一种能点开看原图：
 * - 保护命中还没点开；
 * - 手上只有竖版封面（没有现成横图，放大模糊当氛围底图）；
 * - 选中的图实际是竖版。
 */
const blurred = computed(
  () =>
    media.value.length > 0 &&
    (masked.value || !landscape.value || heroBackdropOf(props.detail).length === 0)
)
const title = computed(() => props.detail.item.title || '未命名影片')
const facts = computed(() => heroFacts(props.detail))
const tags = computed(() => heroTags(props.detail))
/** 副标题：NFO 原名有值且与展示标题不同时才显示 */
const subtitle = computed(() => {
  const original = props.detail.meta?.originalTitle ?? ''
  return original.length > 0 && original !== props.detail.item.title ? original : ''
})

/** 图片加载完量一次实际宽高，竖图自动走模糊底图 */
function onMediaLoad(context: { e: Event }): void {
  const target = context.e.target
  if (target instanceof HTMLImageElement && target.naturalWidth > 0) {
    landscape.value = target.naturalWidth >= target.naturalHeight
  }
}
</script>

<style scoped lang="less">
// 与页面内边距对齐：头部自己出血，文字又不能贴到窗口边缘
@hero-gutter: 20px;

.detail-hero {
  display: flex;
  flex-direction: column;
}

/*
 * 图片带必须自己建一层（`z-index: 0`）：tdesign 的图片根节点是
 * `.t-image__wrapper { position: relative; z-index: 1 }`，带子若只有 `position: relative`
 * （`z-index: auto`）不成层叠上下文，这枚 `z-index: 1` 会被提升到外层，
 * 画在「正 z-index 层」而压过 `z-index: auto` 的 `.hero-body`（标题文字会被图片盖住、看不见）。
 */
.hero-media {
  position: relative;
  z-index: 0;
  height: clamp(260px, 30vw, 400px);
  overflow: hidden;
  background-color: var(--td-bg-color-container-hover);
}

.detail-hero.is-plain .hero-media {
  background-image: linear-gradient(
    135deg,
    var(--td-bg-color-container-hover),
    var(--td-bg-color-container)
  );
}

.hero-image {
  width: 100%;
  height: 100%;
}

.hero-image :deep(img) {
  transition: filter 0.25s ease;
}

// 封面兜底 / 竖图 / 保护命中：放大一圈再模糊，避免露出被模糊稀释掉的边缘
.hero-image.is-blurred {
  transform: scale(1.12);
}

.hero-image.is-blurred :deep(img) {
  filter: blur(28px);
}

/* 保护命中时的可点区域：模糊底图之上给一个提示，点一下换清晰原图 */
.hero-mask {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.hero-mask-button {
  box-shadow: var(--td-shadow-2);
}

/*
 * 底部渐隐到**内容面板底色**：标题落在这一段上，深浅两套主题都能读。
 * 必须用 `--td-bg-color-container`——页面容器（`windows/main/App.vue` 的 `.main-container`）铺的就是它，
 * 换成 `--td-bg-color-page` 会在头部底边压出一条跟面板不同色的硬边色带，正好横切在标题文字上。
 * 82% 就收满：标题块用 -64px 叠上来时第一行落在已完全收满的纯色区，画面上不会有图从字后面透出来。
 */
.hero-scrim {
  position: absolute;
  inset: 0;
  z-index: 1;
  background-image: linear-gradient(
    180deg,
    transparent 0%,
    transparent 32%,
    var(--td-bg-color-container) 82%
  );
}

/* 标题层：`z-index: 1` 压在整个图片带（`z-index: 0`）之上，图片永远盖不到文字 */
.hero-body {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: -64px;
  padding: 0 @hero-gutter;
}

.hero-title {
  margin: 0;
  font-size: 30px;
  font-weight: 700;
  line-height: 1.25;
  color: var(--td-text-color-primary);
  word-break: break-word;
}

.hero-subtitle {
  margin: 0;
  font-size: 13px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--td-text-color-secondary);
  word-break: break-word;
}

.hero-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 24px;
  margin-top: 14px;
}

.hero-facts {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 14px;
  margin-left: auto;
  font-size: 13px;
}

.hero-fact {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
}

// 要点之间用斜杠分隔，跟参考稿的「A / B / C」一致；只在第一项之后打，避免行首多一个斜杠
.hero-fact + .hero-fact::before {
  content: '/';
  margin-right: 12px;
  color: var(--td-text-color-placeholder);
}

.hero-fact-label {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.hero-fact-value {
  color: var(--td-text-color-secondary);
}

.hero-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
</style>
