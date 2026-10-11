<template>
  <section v-if="stills.length > 0" class="still-wall">
    <h4 class="block-title">剧照（{{ stills.length }}）</h4>

    <div class="still-grid">
      <sensitive-image
        v-for="(still, position) in stills"
        :key="still.url"
        class="still-thumb"
        :src="still.url"
        :protect="protect"
        :alt="`剧照 ${position + 1}`"
        @click="open(position)"
      />
    </div>

    <t-image-viewer
      v-model:visible="visible"
      v-model:index="index"
      :images="viewerImages"
      :z-index="6000"
    />
  </section>
</template>
<script setup lang="ts">
/**
 * 详情页的剧照墙：缩略图网格 + 点击后的 tdesign 大图浏览。
 *
 * 契约：
 * - 只画上游筛好的图（主图 / 缩略图与头部已用的背景图由 `stillImagesOf` 去掉），本组件不再判断用途；
 * - 每张缩略图都走 `SensitiveImage`：`protect` 为真时要逐张点开，点开的大图是原图（用户已明确要看）；
 * - 大图浏览必须 `v-model:index` + `v-model:visible`：`index` 是受控 prop，只写不放 v-model 时翻页会失效；
 * - `download: false` 去掉下载按钮（这些地址是 `storage://` 私有协议，浏览器下载不了）；
 * - 本块不画底板与描边：详情页是沉浸式排版，区块只靠标题与留白分隔。
 */
import { computed, ref } from 'vue'
import type { MediaDetailImage } from '@common/types/media'
import SensitiveImage from '@/components/SensitiveImage.vue'

const props = defineProps<{
  images: MediaDetailImage[]
  /** 是否按敏感内容处理：为真时缩略图逐张遮罩 */
  protect: boolean
}>()

const visible = ref(false)
const index = ref(0)

const stills = computed(() => props.images)
const viewerImages = computed(() =>
  props.images.map((still) => ({ mainImage: still.url, download: false }))
)

/** 点缩略图：把大图浏览定位到这一张再打开 */
function open(position: number): void {
  index.value = position
  visible.value = true
}
</script>

<style scoped lang="less">
.still-wall {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.block-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--td-text-color-primary);
}

.still-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}

.still-thumb {
  aspect-ratio: 16 / 9;
  overflow: hidden;
  cursor: zoom-in;
  border-radius: var(--td-radius-medium);
  transition: box-shadow 0.2s ease, transform 0.2s ease;
}

.still-thumb:hover {
  box-shadow: var(--td-shadow-2);
  transform: translateY(-2px);
}
</style>
