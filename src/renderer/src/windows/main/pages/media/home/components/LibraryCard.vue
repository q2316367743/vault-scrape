<template>
  <div class="library-card" @click="open">
    <div class="lib-cover" :class="{ 'lib-cover-empty': covers.length === 0 }">
      <collection-icon v-if="covers.length === 0" class="lib-cover-icon" />
      <img v-for="(url, index) in covers" :key="index" class="lib-cover-img" :src="url" alt="" />
    </div>
    <div class="lib-body">
      <div class="lib-title">
        <span class="lib-name">{{ library.name }}</span>
        <t-tag size="small" variant="outline">{{ typeText }}</t-tag>
      </div>
      <div class="lib-meta">影片 {{ library.videoCount }} 部 · 已刮削 {{ library.scrapedCount }} 部</div>
    </div>
  </div>
</template>
<script setup lang="ts">
/**
 * 首页「资料库」横排里的一张卡：封面四宫格 + 库名 + 类型 + 计数。
 *
 * 契约：
 * - `coverUrls` 最多用 4 张（主进程已限量），为空时用图标占位；
 * - 点击进入该库的内容页（`/media/library?libraryId=<id>`）。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { CollectionIcon } from 'tdesign-icons-vue-next'
import { libraryTypeLabel, type MediaLibrarySummary } from '@common/types/library'

const props = defineProps<{ library: MediaLibrarySummary }>()

const router = useRouter()

const covers = computed(() => props.library.coverUrls.slice(0, 4))
const typeText = computed(() => libraryTypeLabel(props.library.type))

function open(): void {
  void router.push({ name: '影视墙资料库', query: { libraryId: props.library.id } })
}
</script>
<style scoped lang="less">
.library-card {
  flex: 0 0 220px;
  border: 1px solid var(--td-component-border);
  border-radius: 6px;
  background-color: var(--td-bg-color-container);
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.2s;

  &:hover {
    border-color: var(--td-brand-color);
  }
}

.lib-cover {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  grid-auto-rows: 1fr;
  aspect-ratio: 16 / 9;
  background-color: var(--td-bg-color-secondarycontainer);
}

.lib-cover-empty {
  display: flex;
  align-items: center;
  justify-content: center;
}

.lib-cover-icon {
  font-size: 32px;
  color: var(--td-text-color-placeholder);
}

.lib-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.lib-body {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.lib-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.lib-name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  color: var(--td-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lib-meta {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}
</style>
