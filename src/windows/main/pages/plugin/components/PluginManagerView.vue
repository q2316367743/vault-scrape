<template>
  <div class="plugin-body">
    <plugin-list
      :plugins="plugins"
      :active-id="activeId"
      :loading="loading"
      @select="select"
      @reorder="onReorder"
      @refresh="refresh"
      @import-plugins="onImport"
      @set-enabled="onSetEnabledMany"
      @remove-many="onRemoveMany"
    />
    <plugin-detail
      v-if="active"
      :plugin="active"
      :kind="kind"
      @edit="onEdit"
      @remove="onRemove"
      @enabled="onEnabled"
      @changed="onChanged"
    >
      <!-- 类别专属内容（如影片类别的离线数据包面板）由所属页面提供 -->
      <template #extra><slot name="detail-extra" /></template>
    </plugin-detail>
    <t-empty
      v-else
      class="plugin-empty"
      description="左侧还没有可管理的插件，先导入一个本机 .js 脚本"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 插件管理视图：左列表 + 右详情（概览 + 配置），供三个类别页复用。
 *
 * 契约：只按 `kind` 取对应类别的状态与通道，页面本身不感知具体是哪一个类别；
 * 自身不套 page-layout（页头由外壳的 tab 条承担），标题栏与「刷新 / 导入」都下沉到
 * 左列表 `PluginList` 的面板头；批量启停 / 删除与单个一样在这层处理（删除走确认弹窗，
 * 内置插件先剔除）；导入重名走命令式确认弹窗覆盖；配置保存后由详情上抛
 * 最新摘要，这里就地更新列表状态，不整表刷新。
 */
import { onMounted } from 'vue'
import { DialogPlugin, MessagePlugin } from 'tdesign-vue-next'
import {
  type PluginImportResult,
  type PluginKind,
  type PluginSummary
} from '@common/types/plugin'
import { MessageUtil } from '@/utils/modal'
import { usePluginManager } from '../composables/usePluginManager'
import { openPluginEditorDialog } from '../modals/PluginEditorDialog'
import PluginDetail from './PluginDetail.vue'
import PluginList from './PluginList.vue'

const props = defineProps<{ kind: PluginKind }>()

const {
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
} = usePluginManager(props.kind)

onMounted(() => void refresh())

function describeFailures(result: PluginImportResult): string {
  return result.failed.map((item) => `${item.filePath}：${item.message}`).join('；')
}

function describeSkipped(result: PluginImportResult): string {
  return result.skipped.map((item) => `${item.filePath}：${item.message}`).join('；')
}

function handleImport(result: PluginImportResult, canOverwrite: boolean): void {
  if (result.imported.length > 0) MessagePlugin.success(`已导入 ${result.imported.length} 个插件`)
  if (result.skipped.length > 0) {
    MessageUtil.info(`已跳过 ${result.skipped.length} 个旧版本插件：${describeSkipped(result)}`)
  }
  if (result.failed.length === 0) return
  const duplicates = result.failed.filter((item) => item.code === 'duplicate')
  const others = result.failed.filter((item) => item.code !== 'duplicate')
  if (others.length === 0 && duplicates.length > 0 && canOverwrite) {
    const dialog = DialogPlugin.confirm({
      header: '插件已存在',
      body: `以下插件已存在，是否覆盖导入？${describeFailures(result)}`,
      theme: 'warning',
      onConfirm: async () => {
        dialog.hide()
        const next = await importPlugins(true)
        if (next) handleImport(next, false)
      }
    })
    return
  }
  MessagePlugin.error(`有 ${result.failed.length} 个插件导入失败：${describeFailures(result)}`)
}

async function onImport(): Promise<void> {
  const result = await importPlugins(false)
  if (result) handleImport(result, true)
}

function onEdit(plugin: PluginSummary): void {
  openPluginEditorDialog({
    id: plugin.id,
    name: plugin.name,
    load: () => readCode(plugin.id),
    save: (code) => saveCode(plugin.id, code)
  })
}

function onRemove(plugin: PluginSummary): void {
  const dialog = DialogPlugin.confirm({
    header: `删除插件「${plugin.name}」`,
    body: '会同时删除插件源码文件与已保存的环境变量，且不可恢复。',
    theme: 'warning',
    onConfirm: async () => {
      dialog.hide()
      await remove(plugin)
    }
  })
}

function onEnabled(value: boolean): void {
  const plugin = active.value
  if (!plugin) return
  void setEnabled(plugin, value)
}

/** 按 ID 从当前列表里取摘要（批量操作用），已不存在的 ID 自动忽略 */
function summariesOf(ids: string[]): PluginSummary[] {
  return plugins.value.filter((plugin) => ids.includes(plugin.id))
}

function onSetEnabledMany(ids: string[], enabled: boolean): void {
  void setEnabledMany(summariesOf(ids), enabled)
}

/** 批量删除：内置插件没有源码文件、也不可删除，先剔除再确认 */
function onRemoveMany(ids: string[]): void {
  const targets = summariesOf(ids).filter((plugin) => plugin.source !== 'builtin')
  const skipped = ids.length - targets.length
  if (targets.length === 0) {
    MessageUtil.info('内置插件不可删除，当前选中的都是内置插件')
    return
  }
  const dialog = DialogPlugin.confirm({
    header: `删除 ${targets.length} 个插件`,
    body: `会同时删除插件源码文件与已保存的环境变量，且不可恢复。${
      skipped > 0 ? `另有 ${skipped} 个内置插件不可删除，将跳过。` : ''
    }`,
    theme: 'warning',
    onConfirm: async () => {
      dialog.hide()
      await removeMany(targets)
    }
  })
}

function onChanged(plugin: PluginSummary): void {
  applySummary(plugin)
}

function onReorder(ids: string[]): void {
  void reorder(ids)
}
</script>

<style scoped lang="less">
// 左栏自带分隔线，主从两栏之间不再留缝
.plugin-body {
  display: flex;
  height: 100%;
  min-height: 0;
}

.plugin-empty {
  flex: 1;
  padding: 20px;
}
</style>
