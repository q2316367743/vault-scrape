<template>
  <div class="library-drawer">
    <div class="drawer-head">
      <t-button theme="primary" @click="onCreate">
        <template #icon><add-icon /></template>
        新建资料库
      </t-button>
      <t-button variant="outline" :loading="loading" @click="load">
        <template #icon><refresh-icon /></template>
        刷新
      </t-button>
      <span class="drawer-hint">资料库 = 多个媒体目录 + 自己的刮削器，影片按库归集到影视墙</span>
    </div>

    <t-alert v-if="failure" theme="error" :message="failure" />

    <div v-if="scanning" class="scan-bar">
      <t-loading size="small" />
      <div class="scan-text">
        <span class="scan-title">正在扫描资料库…</span>
        <span class="scan-detail">{{ progressText }}</span>
        <span v-if="progress?.currentPath" class="scan-path">{{ progress.currentPath }}</span>
      </div>
      <t-button size="small" variant="outline" @click="cancelScan">取消扫描</t-button>
    </div>

    <div v-if="libraries.length > 0" class="library-list">
      <library-list-item
        v-for="library in libraries"
        :key="library.id"
        :library="library"
        :connections="connections"
        :summary="summaryOf(library.id)"
        :scanning="scanning"
        :busy="busyId === library.id"
        @scan="scan(library)"
        @scrape="scrape(library)"
        @edit="onEdit(library)"
        @remove="onRemove(library)"
      />
    </div>

    <t-empty
      v-else-if="!loading"
      title="还没有资料库"
      description="新建资料库并扫描，影片就会出现在影视墙上"
    />
  </div>
</template>
<script setup lang="ts">
/**
 * 资料库抽屉的内容：列出资料库，提供「扫描影视」与「刮削已扫描的影视」。
 *
 * 契约：
 * - 配置由 `libraryApi` 提供，影片计数取自影视墙读模型（与墙面同口径）；
 * - 扫描是主进程长任务，抽屉只管展示进度与取消，不自己算索引；
 * - 删除只删配置与库内条目：磁盘文件不动；目录若还属于别的库，影片仍会在墙上；
 * - 任何变更都回调 `onChanged`，由页面决定重拉影视墙。
 */
import { computed, onMounted, onUnmounted } from 'vue'
import { AddIcon, RefreshIcon } from 'tdesign-icons-vue-next'
import { useFileConnections } from '@/hooks/UseFileConnections'
import { MessageBoxUtil } from '@/utils/modal'
import type { MediaLibrary } from '@common/types/library'
import { useMediaLibraries } from '../composables/useMediaLibraries'
import LibraryListItem from './LibraryListItem.vue'
import { openLibraryFormDialog } from './LibraryFormDialog'

const props = defineProps<{ onChanged?: () => void }>()

const { connections, refresh: refreshConnections } = useFileConnections()
const {
  libraries,
  loading,
  failure,
  scanning,
  busyId,
  progress,
  summaryOf,
  subscribe,
  restore,
  dispose,
  load,
  remove,
  scan,
  cancelScan,
  scrape
} = useMediaLibraries({ onChanged: () => props.onChanged?.() })

const progressText = computed(() => {
  const event = progress.value
  if (!event) return '正在遍历目录…'
  return `已遍历 ${event.scannedDirs} 个目录，索引 ${event.indexedFiles} 个文件`
})

function onCreated(): void {
  void load()
  props.onChanged?.()
}

function onCreate(): void {
  openLibraryFormDialog({ connections: connections.value, onSaved: onCreated })
}

function onEdit(library: MediaLibrary): void {
  openLibraryFormDialog({ library, connections: connections.value, onSaved: onCreated })
}

async function onRemove(library: MediaLibrary): Promise<void> {
  try {
    await MessageBoxUtil.confirm(
      `将删除资料库「${library.name}」的配置与库内影片记录，磁盘文件不会被删除。一条媒体目录只属于一个资料库，删除后这些影片会从影视墙上消失。`,
      '删除资料库',
      { confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  await remove(library)
}

onMounted(() => {
  subscribe()
  void restore()
  void refreshConnections()
  void load()
})

onUnmounted(() => dispose())
</script>
<style scoped lang="less">
.library-drawer {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.drawer-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.drawer-hint {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.scan-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-medium);
  background-color: var(--td-bg-color-container-hover);
}

.scan-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.scan-title {
  font-size: 13px;
  color: var(--td-text-color-primary);
}

.scan-detail,
.scan-path {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.library-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
