<script setup lang="ts">
/**
 * 存储页右侧浏览器：只读目录浏览 + 预览入口。
 *
 * 契约：没有写操作（新建 / 上传 / 重命名 / 复制 / 移动 / 删除 / 编辑文本全部下线），
 * 工具栏只留「上级目录 / 刷新」；预览统一走 StoragePreviewDrawer。
 */
import { computed, toRef } from 'vue'
import { RefreshIcon } from 'tdesign-icons-vue-next'
import { FILE_PROTOCOL_LABELS, type FileConnection, type FileEntry } from '@common/types/file'
import { useNsfwProtection } from '@/hooks/UseNsfwProtection'
import { useStorageBrowser, type StorageBreadcrumb } from '../composables/useStorageBrowser'
import { openStoragePreviewDrawer } from '../modals/StoragePreviewDrawer'
import { PROTOCOL_ICONS } from '../storageUtils'
import StorageEntryTable from './StorageEntryTable.vue'

const props = defineProps<{
  /** 当前选中的数据源，未选中时展示占位 */
  connection: FileConnection | null
}>()

const connectionId = computed(() => props.connection?.id ?? '')
const { entries, loading, isRoot, breadcrumb, load, go, goParent, open } = useStorageBrowser(connectionId)

/** NSFW 保护：带存储上下文必须用 active（应用总开关 + 该连接的 nsfw 标记同时成立） */
const { active } = useNsfwProtection(toRef(props, 'connection'))

/**
 * 面包屑跳转。
 * 点击必须挂到 t-breadcrumb-item 自身：父级 t-breadcrumb 会按 props 重建每一项，
 * 插槽内的元素（连同其 @click）会被替换成纯文本；当前目录（最后一段）不响应。
 */
function onCrumbClick(segment: StorageBreadcrumb, isCurrent: boolean): void {
  if (isCurrent) return
  void go(segment.path)
}

/** 打开预览抽屉；保护状态在打开时定格，与详情页一次点击的语义一致 */
function onPreview(entry: FileEntry): void {
  const connection = props.connection
  if (!connection) return
  openStoragePreviewDrawer({ connection, entry, protect: active.value })
}
</script>

<template>
  <section class="storage-browser">
    <div v-if="!connection" class="browser-placeholder">
      <t-empty description="请选择左侧数据源，或新建一个连接" />
    </div>

    <template v-else>
      <header class="browser-head">
        <div class="browser-title">
          <component :is="PROTOCOL_ICONS[connection.protocol]" class="browser-title-icon" />
          <span class="browser-title-name">{{ connection.name }}</span>
          <t-tag theme="primary" variant="light">
            {{ FILE_PROTOCOL_LABELS[connection.protocol] }}
          </t-tag>
        </div>
        <div class="browser-toolbar">
          <t-button size="small" variant="outline" :disabled="isRoot" @click="goParent">
            上级目录
          </t-button>
          <t-button size="small" variant="outline" @click="load">
            <template #icon><refresh-icon /></template>
            刷新
          </t-button>
        </div>
      </header>

      <nav class="browser-crumbs">
        <t-breadcrumb>
          <t-breadcrumb-item
            v-for="(segment, index) in breadcrumb"
            :key="segment.path"
            :content="segment.label"
            @click="onCrumbClick(segment, index === breadcrumb.length - 1)"
          />
        </t-breadcrumb>
      </nav>

      <div class="browser-table">
        <storage-entry-table
          :entries="entries"
          :loading="loading"
          @open="open"
          @preview="onPreview"
        />
      </div>
    </template>
  </section>
</template>

<style scoped lang="less">
.storage-browser {
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  // 页面容器已去掉内边距，右侧浏览区自己补回来
  padding: 20px;
}

.browser-placeholder {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--fluent-card-border);
  border-radius: var(--fluent-radius-smooth);
}

.browser-head {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
}

.browser-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.browser-title-icon {
  font-size: 18px;
  color: var(--td-brand-color);
}

.browser-title-name {
  overflow: hidden;
  font-size: 14px;
  font-weight: 500;
  color: var(--td-text-color-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.browser-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
}

.browser-crumbs {
  flex-shrink: 0;
  padding-bottom: 10px;

  // 面包屑项由 t-breadcrumb 按 props 重建，拿不到本组件的 scoped 属性，
  // 因此只能从容器用 :deep 命中 tdesign 自身的类名
  :deep(.t-breadcrumb__item) {
    font-size: 13px;
    color: var(--td-text-color-secondary);
  }

  :deep(.t-breadcrumb__item:not(:last-child)) {
    cursor: pointer;
    transition: color var(--fluent-transition-fast);
  }

  :deep(.t-breadcrumb__item:not(:last-child):hover) {
    color: var(--td-brand-color);
  }

  :deep(.t-breadcrumb__item:last-child) {
    color: var(--td-text-color-primary);
  }
}

.browser-table {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--fluent-card-border);
  border-radius: var(--fluent-radius-smooth);
  background: var(--td-bg-color-container);
  box-shadow: var(--fluent-elevation-1);
}
</style>
