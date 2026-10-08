<script setup lang="ts">
import type { PluginSummary } from '@common/types/plugin'

defineProps<{
  plugins: PluginSummary[]
  activeId: string
  loading: boolean
}>()

const emit = defineEmits<{ select: [id: string] }>()
</script>

<template>
  <t-card class="plugin-list" title="已安装插件" :bordered="true" :loading="loading">
    <template #actions>
      <span class="plugin-count">{{ plugins.length }}</span>
    </template>
    <t-list v-if="plugins.length > 0" split size="small">
      <t-list-item
        v-for="plugin in plugins"
        :key="plugin.id"
        class="plugin-item"
        :class="{ 'is-active': plugin.id === activeId }"
        @click="emit('select', plugin.id)"
      >
        <t-list-item-meta :title="plugin.name" :description="plugin.description || plugin.id" />
        <template #action>
          <div class="plugin-tags">
            <t-tag v-if="plugin.loadError" theme="danger" variant="light">加载失败</t-tag>
            <t-tag v-else-if="!plugin.envReady" theme="warning" variant="light">待填写变量</t-tag>
            <t-tag :theme="plugin.enabled ? 'success' : 'default'" variant="light">
              {{ plugin.enabled ? '已启用' : '已停用' }}
            </t-tag>
          </div>
        </template>
      </t-list-item>
    </t-list>
    <t-empty v-else description="还没有插件，点击右上角「导入插件」选择本机 .js 脚本" />
  </t-card>
</template>

<style scoped lang="less">
.plugin-list {
  width: 300px;
  flex-shrink: 0;
  overflow: auto;
}

.plugin-count {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.plugin-item {
  cursor: pointer;
  transition: background var(--fluent-transition-fast, 0.15s ease);

  &:hover {
    background: var(--td-bg-color-container-hover);
  }

  &.is-active {
    background: var(--td-brand-color-light);
  }
}

.plugin-tags {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}
</style>
