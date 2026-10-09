<template>
  <t-card class="plugin-list" title="已安装插件" :bordered="false" :loading="loading">
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
        <div class="plugin-row">
          <div class="plugin-info">
            <div class="plugin-title">
              <span class="plugin-name">{{ plugin.name }}</span>
              <t-tag
                v-if="plugin.source === 'builtin'"
                size="small"
                theme="primary"
                variant="light"
              >
                内置
              </t-tag>
            </div>
            <t-tooltip :content="plugin.description || plugin.id" placement="top-left">
              <div class="plugin-desc">{{ plugin.description || plugin.id }}</div>
            </t-tooltip>
          </div>
          <div class="plugin-tags">
            <t-tag v-if="plugin.loadError" size="small" theme="danger" variant="light">
              加载失败
            </t-tag>
            <t-tag v-else-if="!plugin.envReady" size="small" theme="warning" variant="light">
              待填写变量
            </t-tag>
            <t-tag size="small" :theme="plugin.enabled ? 'success' : 'default'" variant="light">
              {{ plugin.enabled ? '已启用' : '已停用' }}
            </t-tag>
          </div>
        </div>
      </t-list-item>
    </t-list>
    <t-empty v-else description="还没有插件，点击右上角「导入插件」选择本机 .js 脚本" />
  </t-card>
</template>

<script setup lang="ts">
import type { PluginSummary } from '@common/types/plugin'

defineProps<{
  plugins: PluginSummary[]
  activeId: string
  loading: boolean
}>()

const emit = defineEmits<{ select: [id: string] }>()
</script>

<style scoped lang="less">
// 贴边主从布局的左栏：只是一条右侧分隔线，不做卡片
.plugin-list {
  width: 300px;
  flex-shrink: 0;
  border: 0;
  border-right: 1px solid var(--fluent-sidebar-border);
  border-radius: 0;
  box-shadow: none;
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

// 单行两段式：左侧名称 + 单行描述（超出省略，完整内容走 tooltip），右侧状态标签
.plugin-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.plugin-info {
  flex: 1;
  min-width: 0;
}

.plugin-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.plugin-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  color: var(--td-text-color-primary);
}

.plugin-desc {
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.plugin-tags {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 4px;
}
</style>
