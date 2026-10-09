<template>
  <div class="plugin-detail">
    <header class="detail-head">
      <div class="detail-title">
        <h3 class="title-name">{{ plugin.name }}</h3>
        <span class="title-sub">{{ plugin.id }} · v{{ plugin.version }}</span>
      </div>
      <div class="detail-actions">
        <t-tag v-if="isBuiltin" theme="primary" variant="light">内置</t-tag>
        <t-switch
          :model-value="plugin.enabled"
          :label="['已启用', '已停用']"
          @update:model-value="onToggle"
        />
        <t-button
          v-if="!isBuiltin"
          size="small"
          variant="outline"
          @click="emit('edit', props.plugin)"
        >
          编辑代码
        </t-button>
        <t-button
          v-if="!isBuiltin"
          size="small"
          theme="danger"
          variant="outline"
          @click="emit('remove', props.plugin)"
        >
          删除
        </t-button>
      </div>
    </header>

    <t-alert v-if="plugin.loadError" theme="error" :message="`插件加载失败：${plugin.loadError}`" />
    <t-alert
      v-else-if="!plugin.envReady"
      theme="warning"
      message="必填环境变量尚未填写完整，调用该插件会被拒绝"
    />

    <dl class="detail-meta">
      <div class="meta-item">
        <dt>作者</dt>
        <dd>{{ plugin.author || '—' }}</dd>
      </div>
      <div class="meta-item">
        <dt>源文件</dt>
        <dd class="meta-path">{{ sourceText }}</dd>
      </div>
      <div class="meta-item full">
        <dt>说明</dt>
        <dd>
          <span class="meta-ellipsis">{{ plugin.description || '—' }}</span>
        </dd>
      </div>
    </dl>

    <!-- 只有声明了环境变量的插件才需要配置区块（内置插件、无变量的脚本插件都不显示空区域） -->
    <plugin-config-panel v-if="plugin.hasEnv" :plugin="plugin" @saved="emit('changed', $event)" />

    <offline-pack-panel v-if="isBuiltin" />
  </div>
</template>
<script setup lang="ts">
/**
 * 插件详情：概览信息 + 配置区块（环境变量）；内置插件额外挂载数据源面板。
 *
 * 契约：组件本身不直接调用 API，启停/删除/编辑都通过事件上抛给页面处理；
 * 配置保存后由 PluginConfigPanel 上抛最新摘要，页面据此刷新列表状态。
 */
import { computed } from 'vue'
import type { PluginSummary } from '@common/types/plugin'
import OfflinePackPanel from './OfflinePackPanel.vue'
import PluginConfigPanel from './PluginConfigPanel.vue'

const props = defineProps<{ plugin: PluginSummary }>()
const emit = defineEmits<{
  edit: [plugin: PluginSummary]
  remove: [plugin: PluginSummary]
  enabled: [value: boolean]
  changed: [plugin: PluginSummary]
}>()

/** 内置插件没有源码文件，不能编辑、不能删除 */
const isBuiltin = computed(() => props.plugin.source === 'builtin')
const sourceText = computed(() =>
  isBuiltin.value ? '内置实现（无源码文件）' : props.plugin.filePath
)

function onToggle(value: unknown): void {
  emit('enabled', value === true)
}
</script>

<style scoped lang="less">
.plugin-detail {
  flex: 1;
  min-width: 0;
  overflow: auto;
  // 页面容器已去掉内边距，右侧详情栏自己补回来
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.detail-title {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.title-name {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--td-text-color-primary);
}

.title-sub {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.detail-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.detail-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 24px;
  margin: 0;
  font-size: 13px;
}

.meta-item {
  display: flex;
  gap: 8px;
  min-width: 0;

  &.full {
    grid-column: span 2;
  }

  dt {
    width: 64px;
    flex-shrink: 0;
    color: var(--td-text-color-placeholder);
  }

  dd {
    margin: 0;
    min-width: 0;
    color: var(--td-text-color-primary);
  }
}

.meta-path {
  word-break: break-all;
}

// 长说明只占一行，完整内容悬停查看
.meta-ellipsis {
  display: block;
}
</style>
