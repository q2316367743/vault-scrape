/**
 * 资料库表单的状态与提交（视图见 components/LibraryFormContent.vue）。
 *
 * 契约：
 * - 一个库可以有多个媒体目录：每行 = 存储 + 目录，存储之间互不影响；
 * - 目录一律是**连接内绝对路径**，只能在所选存储里通过「选择媒体目录」弹窗挑
 *   （见 components/RemoteDirDialog.tsx），不做任何本机路径换算；
 * - 类型只在新建时可选，编辑已有资料库时锁定（已有条目是按原类型索引的）；
 * - 刮削器**可以一个都不选**：留空表示这个库不刮削，扫描只负责索引；
 * - 必填校验在这里提示，存储是否存在、目录是否嵌套等最终判定在 `library:save`。
 */
import { computed, onMounted, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { libraryApi } from '@/api'
import { useScraperOptions } from '@/windows/main/pages/storage/composables/useScraperOptions'
import {
  FILE_PROTOCOL_LABELS,
  FILE_ROOT,
  normalizeRemotePath,
  type FileConnection
} from '@common/types/file'
import {
  LIBRARY_IMAGE_SAVE_MODES,
  LIBRARY_IMAGE_SAVE_MODE_LABELS,
  LIBRARY_TYPES,
  LIBRARY_TYPE_LABELS,
  type LibraryImageSaveMode,
  type LibraryType,
  type MediaLibrary,
  type MediaLibraryDraft,
  type MediaLibraryPathDraft
} from '@common/types/library'
import { R18_OFFLINE_PLUGIN_ID } from '@common/types/plugin'
import { openRemoteDirPicker } from '../components/RemoteDirDialog'

/** 表单里的一行「存储 + 目录」；`key` 只用于渲染，不参与提交 */
export interface LibraryPathRow {
  key: string
  connectionId: string
  /** 挑好的连接内路径；空串表示还没挑 */
  dirValue: string
}

export interface UseLibraryFormOptions {
  /** 传入表示编辑已有资料库 */
  library?: MediaLibrary
  /** 可选存储列表 */
  connections: FileConnection[]
  onSaved: (library: MediaLibrary) => void
}

export function useLibraryForm(options: UseLibraryFormOptions) {
  const { options: scraperOptions, loading: scraperLoading, load: loadScrapers, unavailable } =
    useScraperOptions()

  const isCreate = options.library === undefined
  const name = ref(options.library?.name ?? '')
  const type = ref<LibraryType>(options.library?.type ?? 'movie')
  const scrapers = ref<string[]>([...(options.library?.scrapers ?? [])])
  const rows = ref<LibraryPathRow[]>([])
  const nsfwProtection = ref(options.library?.nsfwProtection ?? false)
  const writeNfo = ref(options.library?.writeNfo ?? true)
  const renameEnabled = ref(options.library?.renameEnabled ?? false)
  const moveEnabled = ref(options.library?.moveEnabled ?? false)
  const moveDirectory = ref(options.library?.moveDirectory ?? '')
  const imageSaveMode = ref<LibraryImageSaveMode>(options.library?.imageSaveMode ?? 'media')
  const saving = ref(false)
  let rowSeed = 0

  const connectionOptions = computed(() =>
    options.connections.map((item) => ({
      value: item.id,
      label: `${item.name}（${FILE_PROTOCOL_LABELS[item.protocol]}）`
    }))
  )

  const typeOptions = LIBRARY_TYPES.map((value) => ({
    value,
    label: LIBRARY_TYPE_LABELS[value]
  }))

  /** 类型不可改：已有条目按原类型的后缀索引，中途换类型会留下扫不到的孤儿条目 */
  const typeLocked = computed(() => !isCreate)

  const imageSaveOptions = LIBRARY_IMAGE_SAVE_MODES.map((value) => ({
    value,
    label: LIBRARY_IMAGE_SAVE_MODE_LABELS[value]
  }))

  const staleScrapers = computed(() => (scraperLoading.value ? [] : unavailable(scrapers.value)))

  function connectionOf(connectionId: string): FileConnection | null {
    return options.connections.find((item) => item.id === connectionId) ?? null
  }

  function createRow(connectionId: string, dirValue: string): LibraryPathRow {
    rowSeed += 1
    return { key: `path-${rowSeed}`, connectionId, dirValue }
  }

  /** 新增一行：只有一个存储时默认选中它，目录留给用户去挑 */
  function addPath(): void {
    const connection = options.connections[0]
    if (!connection) {
      MessagePlugin.warning('请先到「存储」页新建数据源')
      return
    }
    rows.value.push(createRow(connection.id, ''))
  }

  function removePath(key: string): void {
    rows.value = rows.value.filter((row) => row.key !== key)
  }

  /** 换存储时清空目录：路径只对原来那个存储有意义 */
  function onConnectionChange(row: LibraryPathRow): void {
    row.dirValue = ''
  }

  /** 打开远程目录弹窗，把挑好的连接内路径写回这一行 */
  function pickDirectory(row: LibraryPathRow): void {
    const connection = connectionOf(row.connectionId)
    if (!connection) {
      MessagePlugin.warning('请先选择存储')
      return
    }
    openRemoteDirPicker({
      connectionId: connection.id,
      connectionName: connection.name,
      initialPath: row.dirValue.trim().length > 0 ? row.dirValue : undefined,
      onPick: (remotePath) => {
        row.dirValue = remotePath
      }
    })
  }

  /** 这一行落库的连接内路径：空目录按存储根目录算 */
  function pathOf(row: LibraryPathRow): string {
    const trimmed = row.dirValue.trim()
    return normalizeRemotePath(trimmed.length > 0 ? trimmed : FILE_ROOT)
  }

  /**
   * 校验并收集媒体目录，顺序固定（与页面提示一致）：
   * 每个目录都选了存储 → 目录不重复 → 目录路径非空。
   */
  function collectPaths(): MediaLibraryPathDraft[] | null {
    if (options.connections.length === 0) {
      MessagePlugin.warning('请先到「存储」页新建数据源')
      return null
    }
    const paths: MediaLibraryPathDraft[] = []
    for (const row of rows.value) {
      const connection = connectionOf(row.connectionId)
      if (!connection) {
        MessagePlugin.warning('请为每个媒体目录选择存储')
        return null
      }
      const path = pathOf(row)
      if (paths.some((item) => item.connectionId === connection.id && item.path === path)) {
        MessagePlugin.warning('存在重复的根目录，请合并后再保存')
        return null
      }
      paths.push({ connectionId: connection.id, path })
    }
    for (const row of rows.value) {
      if (row.dirValue.trim().length === 0) {
        MessagePlugin.warning('请为每个媒体目录选择目录')
        return null
      }
    }
    return paths
  }

  function initRows(): void {
    rows.value = (options.library?.paths ?? []).map((path) => createRow(path.connectionId, path.path))
    if (rows.value.length === 0) addPath()
  }

  /** 新建时默认勾上内置 R18 离线数据包；它不可用时保持不勾（= 这个库不刮削） */
  async function initScrapers(): Promise<void> {
    await loadScrapers()
    if (!isCreate || scrapers.value.length > 0) return
    if (scraperOptions.value.some((item) => item.value === R18_OFFLINE_PLUGIN_ID)) {
      scrapers.value = [R18_OFFLINE_PLUGIN_ID]
    }
  }

  async function onSubmit(): Promise<void> {
    if (name.value.trim().length === 0) {
      MessagePlugin.warning('请填写资料库名称')
      return
    }
    if (rows.value.length === 0) {
      MessagePlugin.warning('请至少添加一个媒体目录')
      return
    }
    const paths = collectPaths()
    if (!paths) return
    const draft: MediaLibraryDraft = {
      type: type.value,
      name: name.value.trim(),
      scrapers: [...scrapers.value],
      paths,
      nsfwProtection: nsfwProtection.value,
      writeNfo: writeNfo.value,
      renameEnabled: renameEnabled.value,
      moveEnabled: moveEnabled.value,
      moveDirectory: moveEnabled.value ? moveDirectory.value.trim() : '',
      imageSaveMode: imageSaveMode.value
    }
    saving.value = true
    const result = await libraryApi.save(
      options.library ? { ...draft, id: options.library.id } : draft
    )
    saving.value = false
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return
    }
    MessagePlugin.success(options.library ? '资料库已更新' : '资料库已创建')
    options.onSaved(result.data)
  }

  onMounted(() => {
    initRows()
    void initScrapers()
  })

  return {
    name,
    type,
    typeOptions,
    typeLocked,
    scrapers,
    rows,
    nsfwProtection,
    writeNfo,
    renameEnabled,
    moveEnabled,
    moveDirectory,
    imageSaveMode,
    saving,
    scraperOptions,
    scraperLoading,
    staleScrapers,
    connectionOptions,
    imageSaveOptions,
    addPath,
    removePath,
    onConnectionChange,
    pickDirectory,
    onSubmit
  }
}
