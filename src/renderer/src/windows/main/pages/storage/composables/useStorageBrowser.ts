/**
 * 存储管理页的目录浏览状态：当前位置、条目列表，以及全部目录 / 文件写操作。
 *
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
  type FileEntry,
  type FileResult
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

  function open(entry: FileEntry): void {
    if (entry.type === 'directory') void go(entry.path)
  }

  async function execute(
    action: () => Promise<FileResult<void>>,
    successText: string
  ): Promise<boolean> {
    const result = await action()
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return false
    }
    MessagePlugin.success(successText)
    return true
  }

  /** 名称合法性最终由主进程复检，这里只挡掉空名与斜杠 */
  function nameError(name: string): string | null {
    const trimmed = name.trim()
    if (trimmed.length === 0) return '名称不能为空'
    if (trimmed.includes('/') || trimmed.includes('\\')) return '名称不能包含斜杠'
    return null
  }

  async function mkdir(name: string): Promise<void> {
    const invalid = nameError(name)
    if (invalid) {
      MessagePlugin.warning(invalid)
      return
    }
    const target = joinRemotePath(path.value, name.trim())
    const done = await execute(
      () => fileApi.mkdir({ connectionId: connectionId.value, path: target }),
      '文件夹已创建'
    )
    if (done) await load()
  }

  async function createFile(name: string): Promise<void> {
    const invalid = nameError(name)
    if (invalid) {
      MessagePlugin.warning(invalid)
      return
    }
    const target = joinRemotePath(path.value, name.trim())
    const done = await execute(
      () => fileApi.createFile({ connectionId: connectionId.value, path: target }),
      '文件已创建'
    )
    if (done) await load()
  }

  async function rename(entry: FileEntry, name: string): Promise<void> {
    const invalid = nameError(name)
    if (invalid) {
      MessagePlugin.warning(invalid)
      return
    }
    const trimmed = name.trim()
    if (trimmed === entry.name) return
    const target = joinRemotePath(dirnameRemotePath(entry.path), trimmed)
    const done = await execute(
      () => fileApi.move({ connectionId: connectionId.value, from: entry.path, to: target }),
      '已重命名'
    )
    if (done) await load()
  }

  async function copy(entry: FileEntry, target: string, overwrite: boolean): Promise<void> {
    const done = await execute(
      () =>
        fileApi.copy({
          connectionId: connectionId.value,
          from: entry.path,
          to: normalizeRemotePath(target),
          overwrite
        }),
      '已复制'
    )
    if (done) await load()
  }

  async function move(entry: FileEntry, target: string, overwrite: boolean): Promise<void> {
    const done = await execute(
      () =>
        fileApi.move({
          connectionId: connectionId.value,
          from: entry.path,
          to: normalizeRemotePath(target),
          overwrite
        }),
      '已移动'
    )
    if (done) await load()
  }

  async function remove(entry: FileEntry): Promise<void> {
    if (isFileRoot(entry.path)) {
      MessagePlugin.warning('不能删除连接根目录')
      return
    }
    const done = await execute(
      () => fileApi.remove({ connectionId: connectionId.value, path: entry.path }),
      '已删除'
    )
    if (done) await load()
  }

  async function readText(entry: FileEntry): Promise<string | null> {
    const result = await fileApi.readText({ connectionId: connectionId.value, path: entry.path })
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return null
    }
    return result.data
  }

  async function writeText(entry: FileEntry, content: string): Promise<boolean> {
    const result = await fileApi.writeText({
      connectionId: connectionId.value,
      path: entry.path,
      content
    })
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return false
    }
    MessagePlugin.success('已保存')
    await load()
    return true
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

  return {
    path,
    entries,
    loading,
    isRoot,
    breadcrumb,
    load,
    go,
    goParent,
    open,
    mkdir,
    createFile,
    rename,
    copy,
    move,
    remove,
    readText,
    writeText
  }
}
