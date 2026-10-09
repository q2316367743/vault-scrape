<script setup lang="ts">
/**
 * 搜索工具页：顶部先用选择器挑「用哪个插件」，下面按关键字搜索候选或按影片 ID 直查详情。
 *
 * 契约：
 * - 与插件页共享同一份「当前插件」选择（`usePlugins` 持久化到 localStorage）；
 * - 已停用、必填变量未填的插件仍可选中，调用会被主进程以中文错误拒绝，渲染层不复制业务规则；
 * - 加载失败的插件直接在选择器里禁用，避免选了必然报错。
 */
import { computed, onMounted } from 'vue'
import { RefreshIcon } from 'tdesign-icons-vue-next'
import SubPageLayout from '@/components/PageLayout/SubPageLayout.vue'
import type { PluginSummary } from '@common/types/plugin'
import { usePlugins } from '@/windows/main/pages/plugin/composables/usePlugins'
import ToolSearchPanel from './components/ToolSearchPanel.vue'

interface PluginOption {
  value: string
  label: string
  disabled: boolean
}

const { plugins, loading, activeId, active, refresh, select } = usePlugins()

function statusText(plugin: PluginSummary): string {
  if (plugin.loadError) return '加载失败'
  if (!plugin.envReady) return '待填写变量'
  if (!plugin.enabled) return '已停用'
  return ''
}

const pluginOptions = computed<PluginOption[]>(() =>
  plugins.value.map((plugin) => {
    const status = statusText(plugin)
    return {
      value: plugin.id,
      label: status ? `${plugin.name} · ${status}` : plugin.name,
      disabled: plugin.loadError.length > 0
    }
  })
)

function onSelect(value: unknown): void {
  if (typeof value === 'string') select(value)
}

onMounted(() => void refresh())
</script>

<template>
  <sub-page-layout title="搜索" description="选择插件后按关键字搜索影片，或按影片 ID 直查详情">
    <template #extra>
      <t-button variant="outline" :loading="loading" @click="refresh">
        <template #icon><refresh-icon /></template>
        刷新
      </t-button>
    </template>

    <div class="search-tool">
      <div class="plugin-picker">
        <span class="picker-label">使用插件</span>
        <t-select
          class="picker-control"
          :model-value="activeId"
          :options="pluginOptions"
          :loading="loading"
          placeholder="选择用于搜索的插件"
          @change="onSelect"
        />
      </div>

      <tool-search-panel v-if="plugins.length > 0" :plugin="active" />
      <t-empty
        v-else-if="!loading"
        title="还没有插件"
        description="先到「插件」页导入本机 .js 脚本，再回来选择要使用的插件"
      />
    </div>
  </sub-page-layout>
</template>

<style scoped lang="less">
.search-tool {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.plugin-picker {
  display: flex;
  align-items: center;
  gap: 12px;
}

.picker-label {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--td-text-color-secondary);
}

.picker-control {
  width: 320px;
}
</style>
