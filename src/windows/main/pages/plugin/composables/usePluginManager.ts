/**
 * 插件列表的页面状态：加载、选中、启停、导入、删除与源码读写。
 *
 * 三类插件（影片信息 / 演员信息 / 翻译）各持一份「模块级」状态与各自的选中项
 * localStorage key，互不影响；`usePluginManager(kind)` 首次调用时创建，之后复用同一份。
 * 选中项被删除后自动回落到该类别第一个可用插件。启停 / 删除都提供单个与批量两组方法，
 * 批量走串行循环（`plugins.json` 读改写，不能并发），完成后再统一刷新。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import { MessagePlugin } from 'tdesign-vue-next'
import { pluginBridge } from '@/api'
import type { PluginImportResult, PluginKind, PluginSummary } from '@common/types/plugin'

/** 选中项持久化 key 前缀，实际 key 为 `<前缀>:<类别>` */
const ACTIVE_PLUGIN_KEY_PREFIX = 'vault-scrape:plugin-active'

export interface PluginManager {
  plugins: Ref<PluginSummary[]>
  loading: Ref<boolean>
  activeId: Ref<string>
  active: ComputedRef<PluginSummary | null>
  refresh: () => Promise<void>
  select: (id: string) => void
  setEnabled: (plugin: PluginSummary, enabled: boolean) => Promise<void>
  /** 批量启停：串行逐个落盘后统一刷新，失败项聚合提示 */
  setEnabledMany: (plugins: PluginSummary[], enabled: boolean) => Promise<void>
  reorder: (ids: string[]) => Promise<void>
  remove: (plugin: PluginSummary) => Promise<void>
  /** 批量删除：调用方需先剔除内置插件（主进程会拒绝删除） */
  removeMany: (plugins: PluginSummary[]) => Promise<void>
  importPlugins: (overwrite?: boolean) => Promise<PluginImportResult | null>
  readCode: (id: string) => Promise<string | null>
  saveCode: (id: string, code: string) => Promise<boolean>
  applySummary: (summary: PluginSummary) => void
}

const managers = new Map<PluginKind, PluginManager>()

function createManager(kind: PluginKind): PluginManager {
  const bridge = pluginBridge(kind)
  const storedActiveId = useLocalStorage(`${ACTIVE_PLUGIN_KEY_PREFIX}:${kind}`, '')
  const plugins = ref<PluginSummary[]>([])
  const loading = ref(false)
  const activeId = ref(storedActiveId.value)

  const active = computed(() => plugins.value.find((item) => item.id === activeId.value) ?? null)

  function select(id: string): void {
    activeId.value = id
    storedActiveId.value = id
  }

  function applySummary(summary: PluginSummary): void {
    plugins.value = plugins.value.map((item) => (item.id === summary.id ? summary : item))
  }

  async function refresh(): Promise<void> {
    loading.value = true
    const result = await bridge.list()
    loading.value = false
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return
    }
    plugins.value = result.data
    const exists = result.data.some((item) => item.id === activeId.value)
    if (!exists) select(result.data[0]?.id ?? '')
  }

  async function setEnabled(plugin: PluginSummary, enabled: boolean): Promise<void> {
    const result = await bridge.setEnabled(plugin.id, enabled)
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return
    }
    applySummary(result.data)
  }

  /**
   * 批量启停。
   *
   * 串行执行：主进程的 `plugins.json` 是「读 → 改 → 写」，并发会互相覆盖；
   * 插件数量只有个位数，串行带来的延迟可以忽略。结束后统一刷新，失败项聚合报错。
   */
  async function setEnabledMany(targets: PluginSummary[], enabled: boolean): Promise<void> {
    if (targets.length === 0) return
    const failed: string[] = []
    for (const plugin of targets) {
      const result = await bridge.setEnabled(plugin.id, enabled)
      if (!result.ok) failed.push(`${plugin.name}：${result.message}`)
    }
    await refresh()
    if (failed.length > 0) {
      MessagePlugin.error(
        `有 ${failed.length} 个插件${enabled ? '启用' : '停用'}失败：${failed.join('；')}`
      )
      return
    }
    MessagePlugin.success(`已${enabled ? '启用' : '停用'} ${targets.length} 个插件`)
  }

  /**
   * 按拖拽结果重排插件顺序。
   *
   * 先就地重排本地列表（拖拽已经改过 DOM，数据跟上才不会闪回），落盘失败时再拉一次真列表还原。
   */
  async function reorder(ids: string[]): Promise<void> {
    const previous = plugins.value
    const byId = new Map(previous.map((item) => [item.id, item]))
    const next = ids
      .map((id) => byId.get(id))
      .filter((item): item is PluginSummary => item !== undefined)
    if (next.length === previous.length) plugins.value = next
    const result = await bridge.reorder(ids)
    if (!result.ok) {
      MessagePlugin.error(result.message)
      await refresh()
      return
    }
    plugins.value = result.data
  }

  async function remove(plugin: PluginSummary): Promise<void> {
    const result = await bridge.remove(plugin.id)
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return
    }
    MessagePlugin.success(`已删除插件「${plugin.name}」`)
    await refresh()
  }

  /**
   * 批量删除。与批量启停同理串行落盘，逐个成功 / 失败分别计数后统一刷新并聚合提示。
   *
   * 调用方负责先剔除内置插件——主进程会以 `unsupported` 拒绝删除内置插件。
   */
  async function removeMany(targets: PluginSummary[]): Promise<void> {
    if (targets.length === 0) return
    const failed: string[] = []
    for (const plugin of targets) {
      const result = await bridge.remove(plugin.id)
      if (!result.ok) failed.push(`${plugin.name}：${result.message}`)
    }
    await refresh()
    const removed = targets.length - failed.length
    if (removed > 0) MessagePlugin.success(`已删除 ${removed} 个插件`)
    if (failed.length > 0) {
      MessagePlugin.error(`有 ${failed.length} 个插件删除失败：${failed.join('；')}`)
    }
  }

  /** 导入本机插件文件；取消选择时返回 null */
  async function importPlugins(overwrite = false): Promise<PluginImportResult | null> {
    const result = await bridge.import(overwrite)
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return null
    }
    await refresh()
    return result.data
  }

  async function readCode(id: string): Promise<string | null> {
    const result = await bridge.readCode(id)
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return null
    }
    return result.data
  }

  async function saveCode(id: string, code: string): Promise<boolean> {
    const result = await bridge.saveCode(id, code)
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return false
    }
    applySummary(result.data)
    MessagePlugin.success('插件已保存并通过校验')
    return true
  }

  return {
    plugins,
    loading,
    activeId,
    active,
    refresh,
    select,
    setEnabled,
    setEnabledMany,
    reorder,
    remove,
    removeMany,
    importPlugins,
    readCode,
    saveCode,
    applySummary
  }
}

/** 取某个类别的插件页面状态；同一个类别在多次调用间共享同一份状态 */
export function usePluginManager(kind: PluginKind): PluginManager {
  const cached = managers.get(kind)
  if (cached) return cached
  const manager = createManager(kind)
  managers.set(kind, manager)
  return manager
}
