/**
 * 存储管理页的目录浏览状态：当前位置与条目列表。
 *
 * 页面只读：按需求「存储不需要管理存储文件」，新建 / 重命名 / 复制 / 移动 / 删除 / 编辑文本 /
 * 上传下载都已移除，这里只负责进入目录与刷新。
 * 页面级临时状态，不进 pinia：切走即丢弃，再次进入从连接根开始。
 */
import { computed, ref, watch, type Ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { fileApi } from '@/api'
import {
  FILE_ROOT,
  dirnameRemotePath,
  isFileRoot,
  joinRemotePath,
  normalizeRemotePath,
  splitRemotePath,
  type FileEntry
} from '@common/types/file'

export interface StorageBreadcrumb {
  label: string
  path: string
}

const ROOT_LABEL = '根目录'

export function useStorageBrowser(connectionId: Ref<string>) {
  const path = ref(FILE_ROOT)
  const entries = ref<FileEntry[]>([])
  const loading = ref(false)

  const isRoot = computed(() => isFileRoot(path.value))
  const breadcrumb = computed<StorageBreadcrumb[]>(() => {
    const segments: StorageBreadcrumb[] = [{ label: ROOT_LABEL, path: FILE_ROOT }]
    let accumulated = FILE_ROOT
    for (const segment of splitRemotePath(path.value)) {
      accumulated = joinRemotePath(accumulated, segment)
      segments.push({ label: segment, path: accumulated })
    }
    return segments
  })

  async function fetchEntries(target: string): Promise<boolean> {
    const id = connectionId.value
    if (id.length === 0) {
      entries.value = []
      return false
    }
    loading.value = true
    const result = await fileApi.list({ connectionId: id, path: target })
    loading.value = false
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return false
    }
    path.value = target
    entries.value = result.data
    return true
  }

  async function load(): Promise<void> {
    await fetchEntries(path.value)
  }

  /** 进入目录；目标不可读时退回连接根，避免页面卡在坏路径上 */
  async function go(target: string): Promise<void> {
    const normalized = normalizeRemotePath(target)
    if (await fetchEntries(normalized)) return
    if (normalized !== FILE_ROOT) await fetchEntries(FILE_ROOT)
  }

  function goParent(): void {
    void go(dirnameRemotePath(path.value))
  }

  /** 只用于进入目录：文件由预览抽屉负责 */
  function open(entry: FileEntry): void {
    if (entry.type === 'directory') void go(entry.path)
  }

  watch(
    connectionId,
    () => {
      path.value = FILE_ROOT
      entries.value = []
      void load()
    },
    { immediate: true }
  )

  return { entries, loading, isRoot, breadcrumb, load, go, goParent, open }
}
