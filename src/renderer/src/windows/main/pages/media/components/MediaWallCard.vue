<script setup lang="ts">
/**
 * 影视墙的一张卡片：磁盘上的一个视频 + 能补上的刮削信息。
 *
 * 契约：
 * - 封面只走 `item.coverUrl`（`storage://` 协议），没有封面时显示占位，不自己拼路径；
 * - NSFW 保护按「全局开关 + 本条记录所属存储的 nsfw 标记」判定，连接由父页面传进来；
 * - 点击整张卡片打开详情抽屉；卡片内其它可点击元素（如遮罩按钮）必须自己阻止冒泡。
 */
import { computed } from 'vue'
import { FilmIcon, TagIcon } from 'tdesign-icons-vue-next'
import SensitiveImage from '@/components/SensitiveImage.vue'
import { useNsfwProtection } from '@/hooks/UseNsfwProtection'
import type { FileConnection } from '@common/types/file'
import type { MediaWallItem } from '@common/types/media'
import { openMediaDetailDrawer } from '../modals/MediaDetailDrawer'
import { formatSize, formatTime } from '../mediaUtils'

const props = defineProps<{
  item: MediaWallItem
  /** 本条记录所属的存储；连接列表还没加载完时可能为 null */
  connection: FileConnection | null
  /** 数据源名称，仅用于角标 */
  sourceName: string
}>()

const { active } = useNsfwProtection(computed(() => props.connection))

function openDetail(): void {
  openMediaDetailDrawer({
    connectionId: props.item.connectionId,
    path: props.item.path,
    title: props.item.title,
    sourceName: props.sourceName,
    protect: active.value
  })
}
</script>

<template>
  <div class="media-card" @click="openDetail">
    <div class="card-cover">
      <sensitive-image
        v-if="item.coverUrl"
        :src="item.coverUrl"
        :protect="active"
        alt="影片封面"
        fit="cover"
      />
      <div v-else class="cover-placeholder">
        <film-icon size="28px" />
        <span>{{ item.scraped ? '没有封面' : '未刮削' }}</span>
      </div>
      <t-tag
        class="cover-badge"
        size="small"
        :theme="item.scraped ? 'success' : 'default'"
        variant="light-outline"
      >
        {{ item.scraped ? '已刮削' : '未刮削' }}
      </t-tag>
    </div>

    <div class="card-body">
      <t-tooltip :content="item.title" placement="top-left">
        <div class="card-title">{{ item.title }}</div>
      </t-tooltip>
      <div class="card-meta">
        <t-tag v-if="item.num" size="small" theme="primary" variant="light-outline">
          <template #icon><tag-icon /></template>{{ item.num }}
        </t-tag>
        <t-tag size="small" variant="outline">{{ sourceName || '未知数据源' }}</t-tag>
      </div>
      <div class="card-foot">
        <span>{{ formatSize(item.size) }}</span>
        <span>{{ formatTime(item.modifiedAt) }}</span>
      </div>
    </div>
  </div>
</template>

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
  aspect-ratio: 3 / 4;
  background-color: var(--td-bg-color-container-hover);
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

.cover-badge {
  position: absolute;
  top: 6px;
  right: 6px;
}

.card-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px 10px;
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
  -webkit-line-clamp: 2;
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
