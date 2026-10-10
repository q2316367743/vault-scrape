<template>
  <div class="remote-dir">
    <div class="dir-head">
      <span class="dir-store">存储：{{ connectionName }}</span>
      <t-button size="small" variant="outline" :disabled="isRoot" @click="goParent">
        上级目录
      </t-button>
    </div>

    <t-breadcrumb>
      <t-breadcrumb-item
        v-for="(segment, index) in breadcrumb"
        :key="segment.path"
        :content="segment.label"
        @click="onCrumbClick(index)"
      />
    </t-breadcrumb>

    <div class="dir-body">
      <div v-if="loading" class="dir-center">
        <t-loading size="small" text="正在读取目录…" />
      </div>
      <div v-else-if="directories.length === 0" class="dir-center">
        <t-empty title="这个目录下没有子目录" />
      </div>
      <ul v-else class="dir-list">
        <li v-for="entry in directories" :key="entry.path" class="dir-item" @click="enter(entry.path)">
          <folder-icon class="dir-icon" />
          <span class="dir-name">{{ entry.name }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
<script setup lang="ts">
/**
 * 「选择媒体目录」弹窗的内容组件（外壳见同目录 RemoteDirDialog.tsx）。
 *
 * 契约：
 * - 路径一律是**连接内绝对路径**（`/` 是连接根），这里不做任何本机路径换算；
 * - 只列 `type === 'directory'` 的条目，点击进入；文件不展示也不可选；
 * - 取消 / 「选择当前目录」按钮在外壳 footer，这里用 `defineExpose` 把当前路径与选择动作交出去
 *   （见 `@/utils/modal/ModalContent`），路径变化时 footer 的「当前目录」跟着变；
 * - 根目录同样可以选；
 * - 加载失败只提示，不弹回上一级：用户能看到面包屑，自己点回去更清楚。
 */
import { computed, onMounted, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { FolderIcon } from 'tdesign-icons-vue-next'
import { fileApi } from '@/api'
import {
  FILE_ROOT,
  dirnameRemotePath,
  isFileRoot,
  joinRemotePath,
  normalizeRemotePath,
  sortFileEntries,
  splitRemotePath,
  type FileEntry
} from '@common/types/file'

const props = defineProps<{
  connectionId: string
  connectionName: string
  /** 打开时定位到的路径；缺省从连接根目录开始 */
  initialPath?: string
}>()

const emit = defineEmits<{ pick: [remotePath: string] }>()

const path = ref(normalizeRemotePath(props.initialPath ?? FILE_ROOT))
const directories = ref<FileEntry[]>([])
const loading = ref(false)

/** 面包屑：根目录 + 逐级路径，最后一段是当前目录 */
const breadcrumb = computed(() => {
  const segments = splitRemotePath(path.value)
  const crumbs = [{ label: '根目录', path: FILE_ROOT }]
  segments.forEach((segment, index) => {
    crumbs.push({ label: segment, path: joinRemotePath(...segments.slice(0, index + 1)) })
  })
  return crumbs
})

const isRoot = computed(() => isFileRoot(path.value))

async function load(): Promise<void> {
  loading.value = true
  const result = await fileApi.list({ connectionId: props.connectionId, path: path.value })
  loading.value = false
  if (!result.ok) {
    directories.value = []
    MessagePlugin.error(result.message)
    return
  }
  directories.value = sortFileEntries(result.data.filter((entry) => entry.type === 'directory'))
}

function go(target: string): void {
  path.value = normalizeRemotePath(target)
  void load()
}

function goParent(): void {
  if (isRoot.value) return
  go(dirnameRemotePath(path.value))
}

function onCrumbClick(index: number): void {
  // 当前目录（最后一段）不响应点击
  if (index >= breadcrumb.value.length - 1) return
  const segment = breadcrumb.value[index]
  if (segment) go(segment.path)
}

function enter(target: string): void {
  go(target)
}

function choose(): void {
  emit('pick', path.value)
}

/** 交给外壳 footer：`path` 用于左侧「当前目录」，`submit` 对应「选择当前目录」 */
defineExpose({ submit: choose, path })

onMounted(() => {
  void load()
})
</script>
<style scoped lang="less">
.remote-dir {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dir-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.dir-store {
  font-size: 13px;
  color: var(--td-text-color-secondary);
}

.dir-body {
  min-height: 220px;
  max-height: 380px;
  overflow: auto;
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-medium);
}

.dir-center {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 220px;
}

.dir-list {
  margin: 0;
  padding: 4px;
  list-style: none;
}

.dir-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--td-radius-small);
  color: var(--td-text-color-primary);
  cursor: pointer;

  &:hover {
    background-color: var(--td-bg-color-container-hover);
  }
}

.dir-icon {
  color: var(--td-brand-color);
}

.dir-name {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
