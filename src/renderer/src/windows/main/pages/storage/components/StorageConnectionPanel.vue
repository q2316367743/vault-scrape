<script setup lang="ts">
import { AddIcon, DeleteIcon, Edit1Icon, LinkIcon } from 'tdesign-icons-vue-next'
import { FILE_PROTOCOL_LABELS, describeConnection, describeScrapers, type FileConnection } from '@common/types/file'
import { PROTOCOL_ICONS } from '../storageUtils'

defineProps<{
  /** 已保存的数据源 */
  connections: FileConnection[]
  /** 当前选中的数据源 id */
  activeId: string
}>()

const emit = defineEmits<{
  select: [id: string]
  create: []
  edit: [connection: FileConnection]
  remove: [connection: FileConnection]
  test: [connection: FileConnection]
}>()
</script>

<template>
  <aside class="connection-panel">
    <header class="panel-head">
      <span class="panel-title">数据源</span>
      <t-tooltip content="新建数据源">
        <t-button variant="text" size="small" @click="emit('create')">
          <template #icon><add-icon /></template>
        </t-button>
      </t-tooltip>
    </header>

    <div class="panel-body">
      <div v-if="connections.length === 0" class="panel-empty">
        <t-empty description="还没有数据源" />
        <t-button size="small" theme="primary" variant="outline" @click="emit('create')">
          新建连接
        </t-button>
      </div>

      <ul v-else class="connection-list">
        <li
          v-for="connection in connections"
          :key="connection.id"
          class="connection-item"
          :class="{ 'is-active': connection.id === activeId }"
          @click="emit('select', connection.id)"
        >
          <div class="connection-main">
            <component :is="PROTOCOL_ICONS[connection.protocol]" class="connection-icon" />
            <div class="connection-name" :title="connection.name">{{ connection.name }}</div>

            <div class="connection-actions">
              <t-tooltip content="测试连通">
                <t-button variant="text" size="small" @click.stop="emit('test', connection)">
                  <template #icon><link-icon /></template>
                </t-button>
              </t-tooltip>
              <t-tooltip content="编辑">
                <t-button variant="text" size="small" @click.stop="emit('edit', connection)">
                  <template #icon><edit1-icon /></template>
                </t-button>
              </t-tooltip>
              <t-tooltip content="删除">
                <t-button
                  variant="text"
                  size="small"
                  theme="danger"
                  @click.stop="emit('remove', connection)"
                >
                  <template #icon><delete-icon /></template>
                </t-button>
              </t-tooltip>
            </div>
          </div>

          <div class="connection-meta">
            <div class="connection-desc" :title="describeConnection(connection)">
              {{ describeConnection(connection) }}
            </div>
            <div class="connection-tags">
              <t-tag size="small" theme="primary" variant="light">
                {{ FILE_PROTOCOL_LABELS[connection.protocol] }}
              </t-tag>
              <t-tag size="small" variant="light-outline">
                {{ describeScrapers(connection) }}
              </t-tag>
              <t-tag v-if="connection.nsfw" size="small" theme="danger" variant="light">
                NSFW
              </t-tag>
            </div>
          </div>
        </li>
      </ul>
    </div>
  </aside>
</template>

<style scoped lang="less">
// 贴边主从布局的左栏：只是一条右侧分隔线，不做卡片
.connection-panel {
  display: flex;
  flex-direction: column;
  // 与插件页左栏保持同一宽度约定（见 docs/ui/01-renderer-shell.md）
  width: 300px;
  flex-shrink: 0;
  overflow: hidden;
  border-right: 1px solid var(--fluent-sidebar-border);
  background: var(--td-bg-color-container);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 8px 0 14px;
  border-bottom: 1px solid var(--fluent-card-border);
}

.panel-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--td-text-color-primary);
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}

.panel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 0;
}

.connection-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

// 两段式：第一行图标 + 名称（操作按钮只在悬停 / 选中时出现），第二行描述与标签
.connection-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: var(--fluent-radius-smooth);
  cursor: pointer;
  transition: background var(--fluent-transition-fast);
}

.connection-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.connection-item:hover {
  background: var(--fluent-item-hover);
}

.connection-item.is-active {
  background: var(--fluent-item-selected);
  box-shadow: inset 2px 0 0 0 var(--td-brand-color);
}

.connection-icon {
  flex-shrink: 0;
  font-size: 16px;
  color: var(--td-text-color-secondary);
}

.connection-item.is-active .connection-icon {
  color: var(--td-brand-color);
}

.connection-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  color: var(--td-text-color-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.connection-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding-left: 24px;
}

.connection-desc {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 11px;
  color: var(--td-text-color-placeholder);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.connection-tags {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
}

.connection-actions {
  display: none;
  flex-shrink: 0;
  align-items: center;
}

.connection-item:hover .connection-actions,
.connection-item.is-active .connection-actions {
  display: flex;
}
</style>
