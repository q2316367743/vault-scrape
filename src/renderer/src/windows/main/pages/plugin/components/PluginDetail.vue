<script setup lang="ts">
/**
 * 插件详情：概览信息 + 测试面板。
 *
 * 契约：组件本身不直接调用 API，启停/删除/编辑都通过事件上抛给页面处理；
 * 环境变量统一在「设置 → 账号设置」填写，这里只做提示与跳转。
 */
import { useRouter } from 'vue-router'
import type { PluginSummary } from '@common/types/plugin'
import PluginTestPanel from './PluginTestPanel.vue'

const props = defineProps<{ plugin: PluginSummary }>()
const emit = defineEmits<{
  edit: [plugin: PluginSummary]
  remove: [plugin: PluginSummary]
  enabled: [value: boolean]
}>()

const router = useRouter()

function onToggle(value: unknown): void {
  emit('enabled', value === true)
}

function goAccount(): void {
  void router.push({ name: '设置', query: { group: 'account' } })
}
</script>

<template>
  <div class="plugin-detail">
    <header class="detail-head">
      <div class="detail-title">
        <h3 class="title-name">{{ plugin.name }}</h3>
        <span class="title-sub">{{ plugin.id }} · v{{ plugin.version }}</span>
      </div>
      <div class="detail-actions">
        <t-switch
          :model-value="plugin.enabled"
          :label="['已启用', '已停用']"
          @update:model-value="onToggle"
        />
        <t-button size="small" variant="outline" @click="emit('edit', props.plugin)">
          编辑代码
        </t-button>
        <t-button
          size="small"
          theme="danger"
          variant="outline"
          @click="emit('remove', props.plugin)"
        >
          删除
        </t-button>
      </div>
    </header>

    <t-alert
      v-if="plugin.loadError"
      theme="error"
      :message="`插件加载失败：${plugin.loadError}`"
    />
    <t-alert
      v-else-if="!plugin.envReady"
      theme="warning"
      message="必填环境变量尚未填写完整，调用该插件会被拒绝"
    />

    <div v-if="plugin.hasEnv" class="env-hint">
      <span class="hint-text">该插件声明的环境变量在「设置 → 账号设置」中统一填写</span>
      <t-button size="small" variant="outline" @click="goAccount">去填写</t-button>
    </div>

    <dl class="detail-meta">
      <div class="meta-item">
        <dt>作者</dt>
        <dd>{{ plugin.author || '—' }}</dd>
      </div>
      <div class="meta-item">
        <dt>说明</dt>
        <dd>{{ plugin.description || '—' }}</dd>
      </div>
      <div class="meta-item">
        <dt>源文件</dt>
        <dd class="meta-path">{{ plugin.filePath }}</dd>
      </div>
      <div class="meta-item">
        <dt>环境变量</dt>
        <dd>{{ plugin.hasEnv ? '已声明' : '无' }}</dd>
      </div>
    </dl>

    <plugin-test-panel :plugin="plugin" />
  </div>
</template>

<style scoped lang="less">
.plugin-detail {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 0 4px;
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

.env-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 12px;
  border: 1px solid var(--td-border-level-1-color);
  border-radius: 6px;
  background: var(--td-bg-color-container);
}

.hint-text {
  font-size: 12px;
  color: var(--td-text-color-secondary);
}
</style>
