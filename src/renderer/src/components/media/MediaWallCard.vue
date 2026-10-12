<template>
  <div class="media-card" :title="item.title" @click="openDetail">
    <div class="card-cover">
      <sensitive-image
        v-if="item.coverUrl"
        :src="item.coverUrl"
        :protect="protect"
        :alt="item.type === 'series' ? '剧集封面' : '影片封面'"
        fit="cover"
      />
      <div v-else class="cover-placeholder">
        <film-icon size="28px" />
        <span>没有封面</span>
      </div>
    </div>

    <div class="card-body">
      <t-tooltip :content="item.title" placement="top-left">
        <div class="card-title">{{ item.title }}</div>
      </t-tooltip>
      <div class="card-meta">
        <t-tag v-if="item.num" size="small" theme="primary" variant="light-outline">
          <template #icon><tag-icon /></template>{{ item.num }}
        </t-tag>
        <t-tag v-if="episodeSummary" size="small" theme="success" variant="light-outline">
          {{ episodeSummary }}
        </t-tag>
        <t-tag size="small" variant="outline">
          {{ item.libraryName }}
        </t-tag>
      </div>
      <div class="card-foot">
        <span>{{ formatSize(item.size) }}</span>
        <span>{{ formatTime(item.modifiedAt) }}</span>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
/**
 * 影视墙的一张卡片：磁盘上的一条记录（影片是一个视频，剧集是整部剧）能补上的刮削信息。
 *
 * 契约：
 * - 剧集卡多一枚「N 季 M 集」标签、不显示番号（剧集没有番号，`item.num` 恒为空串）；
 * - 封面只走 `item.coverUrl`（`storage://` 协议），没有封面时显示占位，不自己拼路径；
 * - NSFW 保护按「全局开关 + 存储 nsfw 标记 + 所属资料库的 nsfwProtection」判定，任一命中即遮罩；
 * - 点击整张卡片跳详情页，参数只带 `itemId`（影片身份），播放与更细的信息都在那边；
 *   卡片内其它可点击元素（如遮罩按钮）必须自己阻止冒泡。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { FilmIcon, TagIcon } from 'tdesign-icons-vue-next'
import SensitiveImage from '@/components/SensitiveImage.vue'
import { useNsfwProtection } from '@/hooks/UseNsfwProtection'
import type { FileConnection } from '@common/types/file'
import type { MediaWallItem } from '@common/types/media'
import { formatSize, formatTime } from '@/utils/format'

const props = defineProps<{
  item: MediaWallItem
  /** 本条记录所属的存储；连接列表还没加载完时可能为 null */
  connection: FileConnection | null
}>()

const router = useRouter()
const { active } = useNsfwProtection(computed(() => props.connection))
/** 全局开关 + 存储标记命中，或所属资料库自己要求按敏感内容处理 */
const protect = computed(() => active.value || props.item.nsfwProtected)
/** 剧集卡的第二枚标签：N 季 M 集；影片返回空串，模板里不渲染 */
const episodeSummary = computed(() =>
  props.item.type === 'series' ? `${props.item.seasonCount} 季 ${props.item.episodeCount} 集` : ''
)

function openDetail(): void {
  void router.push({
    name: '影视墙详情',
    query: { itemId: props.item.itemId }
  })
}
</script>
<style scoped lang="less">
.media-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-medium);
  background-color: var(--td-bg-color-container);
  cursor: pointer;
  transition:
    box-shadow var(--fluent-transition-normal),
    border-color var(--fluent-transition-normal);

  &:hover {
    border-color: var(--td-brand-color-hover);
    box-shadow: var(--td-shadow-2);
  }
}

.card-cover {
  position: relative;
  /* 封面高度只由宽度与 aspect-ratio 决定：不收缩、不吃内容的自动最小高度，
     否则竖版原图（比 3/4 更高）会把封面撑高，有没有封面的卡片标题就对不齐 */
  flex: none;
  min-height: 0;
  overflow: hidden;
  aspect-ratio: 3 / 4;
  background-color: var(--td-bg-color-container-hover);

  /* 图片整层绝对定位，彻底不参与封面高度计算 */
  :deep(.sensitive-image) {
    position: absolute;
    inset: 0;
  }
}

.cover-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 100%;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.card-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 6px;
  min-width: 0;
}

.card-title {
  display: -webkit-box;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.4;
  color: var(--td-text-color-primary);
  word-break: break-word;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex-wrap: wrap;
}

.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}
</style>
