<script setup lang="ts">
/**
 * 插件页：左侧插件列表，右侧详情（概览 + 测试；环境变量在设置页统一填写）。
 *
 * 契约：页面只通过 `@/api` 间接访问主进程；导入重名走命令式确认弹窗覆盖。
 */
import { onMounted } from 'vue'
import { DialogPlugin, MessagePlugin } from 'tdesign-vue-next'
import { AddIcon, RefreshIcon } from 'tdesign-icons-vue-next'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import type { PluginImportResult, PluginSummary } from '@common/types/plugin'
import { usePlugins } from './composables/usePlugins'
import { openPluginEditorDialog } from './modals/PluginEditorDialog'
import PluginList from './components/PluginList.vue'
import PluginDetail from './components/PluginDetail.vue'

const {
  plugins,
  loading,
  activeId,
  active,
  refresh,
  select,
  setEnabled,
  remove,
  importPlugins,
  readCode,
  saveCode
} = usePlugins()

onMounted(() => void refresh())

function describeFailures(result: PluginImportResult): string {
  return result.failed.map((item) => `${item.filePath}：${item.message}`).join('；')
}

function handleImport(result: PluginImportResult, canOverwrite: boolean): void {
  if (result.imported.length > 0) MessagePlugin.success(`已导入 ${result.imported.length} 个插件`)
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
</script>

<template>
  <page-layout
    title="插件"
    description="导入本机 JS 刮削插件：启停、测试与源码编辑。环境变量在「设置 → 账号设置」填写；插件只产出「下载配置」，真正的下载由后续调度器负责。"
  >
    <template #extra>
      <t-button variant="outline" :loading="loading" @click="refresh">
        <template #icon><refresh-icon /></template>
        刷新
      </t-button>
      <t-button theme="primary" @click="onImport">
        <template #icon><add-icon /></template>
        导入插件
      </t-button>
    </template>

    <div class="plugin-body">
      <plugin-list
        :plugins="plugins"
        :active-id="activeId"
        :loading="loading"
        @select="select"
      />
      <plugin-detail
        v-if="active"
        :plugin="active"
        @edit="onEdit"
        @remove="onRemove"
        @enabled="onEnabled"
      />
      <t-empty v-else description="左侧还没有可管理的插件，先导入一个本机 .js 脚本" />
    </div>
  </page-layout>
</template>

<style scoped lang="less">
.plugin-body {
  display: flex;
  gap: 16px;
  height: 100%;
  min-height: 0;
}
</style>
