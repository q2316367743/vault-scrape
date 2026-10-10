<template>
  <t-card title="刮削范围" class="source-panel">
    <div class="panel-body">
      <t-select
        :model-value="libraryId"
        :options="libraryOptions"
        :loading="loading"
        :disabled="locking"
        placeholder="选择资料库"
        @change="onLibraryChange"
      />

      <div v-if="library" class="library-note">
        <t-tag size="small" variant="outline">{{ library.paths.length }} 个目录</t-tag>
        <t-tag v-if="library.scrapers.length === 0" size="small" variant="outline">不刮削</t-tag>
      </div>
      <p v-else class="panel-note">还没有资料库，请先到影视墙的「资料库」里新建</p>

      <div class="browse-head">
        <span class="browse-label">浏览目录</span>
        <t-button
          size="small"
          variant="text"
          :disabled="!canGoUp || locking"
          @click="emit('navigate', parentPath)"
        >
          上一级
        </t-button>
      </div>

      <t-breadcrumb class="browse-crumbs">
        <t-breadcrumb-item v-for="(crumb, index) in crumbs" :key="crumb.path">
          <t-button
            v-if="index < crumbs.length - 1"
            size="small"
            variant="text"
            :disabled="locking"
            @click="emit('navigate', crumb.path)"
          >
            {{ crumb.label }}
          </t-button>
          <span v-else class="crumb-current">{{ crumb.label }}</span>
        </t-breadcrumb-item>
      </t-breadcrumb>

      <p class="panel-note">当前目录：{{ dirPath }}</p>
      <p class="panel-note">已勾选 {{ selectedCount }} 个影片</p>
    </div>
  </t-card>
</template>
<script setup lang="ts">
/**
 * 工作台左栏：选资料库 + 面包屑导航。
 *
 * 契约：
 * - 只负责选库与发导航意图，真正的 `scrape:browse` 调用在 `useWorkspaceScrape`；
 * - 路径一律是连接内绝对路径（`/` 表示库根），不展示本机路径。
 */
import { computed } from 'vue'
import { FILE_ROOT } from '@common/types/file'
import type { MediaLibrary } from '@common/types/library'
import type { WorkspaceCrumb } from '../composables/useWorkspaceScrape'

const props = defineProps<{
  libraries: MediaLibrary[]
  libraryId: string
  library: MediaLibrary | null
  dirPath: string
  crumbs: WorkspaceCrumb[]
  loading: boolean
  /** 有任务在跑时锁定切换 */
  locking: boolean
  selectedCount: number
}>()

const emit = defineEmits<{
  'update:libraryId': [id: string]
  navigate: [path: string]
}>()

const libraryOptions = computed(() =>
  props.libraries.map((item) => ({ value: item.id, label: item.name }))
)

const canGoUp = computed(() => props.dirPath !== FILE_ROOT)
const parentPath = computed(() => {
  const index = props.dirPath.lastIndexOf('/')
  return index <= 0 ? FILE_ROOT : props.dirPath.slice(0, index)
})

function onLibraryChange(value: unknown): void {
  if (typeof value === 'string') emit('update:libraryId', value)
}
</script>
<style scoped lang="less">
.source-panel {
  width: 320px;
  flex-shrink: 0;
}

.panel-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.library-note {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.panel-note {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--td-text-color-placeholder);
  word-break: break-all;
}

.browse-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}

.browse-label {
  font-size: 13px;
  color: var(--td-text-color-secondary);
}

.browse-crumbs {
  flex-wrap: wrap;
}

.crumb-current {
  font-size: 13px;
  color: var(--td-text-color-primary);
}
</style>
