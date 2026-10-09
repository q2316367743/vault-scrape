<script setup lang="ts">
/**
 * 插件配置：填写该插件声明的环境变量。
 *
 * 契约：
 * - 环境变量一律是多行文本（Cookie、Token 这类值本身就可能很长），统一按敏感值处理；
 * - 已保存的值不回显，文本域留空即表示「保持已保存的值」；
 * - 保存以插件为单位，只提交本次填写的项；保存成功后把最新的 PluginSummary 上抛给页面，
 *   由页面更新列表里的「待填写变量」等状态。
 */
import { computed, ref, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import type { PluginEnvField, PluginSummary } from '@common/types/plugin'
import { pluginApi } from '@/api'

const props = defineProps<{ plugin: PluginSummary }>()
const emit = defineEmits<{ saved: [plugin: PluginSummary] }>()

const loading = ref(false)
const saving = ref(false)
const fields = ref<PluginEnvField[]>([])
const filled = ref<Record<string, boolean>>({})
const values = ref<Record<string, string>>({})

/** 读不到声明表时的空态文案：区分「没声明」「加载失败」「声明表为空」三种情况 */
const emptyTitle = computed(() => {
  if (props.plugin.loadError) return '插件加载失败，暂时无法读取配置'
  if (!props.plugin.hasEnv) return '该插件未声明环境变量'
  return '没有需要填写的环境变量'
})

const emptyDescription = computed(() => {
  if (props.plugin.loadError) return '先修复插件加载错误，再填写环境变量'
  if (!props.plugin.hasEnv) return '插件在源码中用 env 声明需要填写的变量'
  return '插件声明的变量都已填写完整'
})

function placeholderOf(field: PluginEnvField, saved: boolean): string {
  if (saved) return '已保存，留空表示保持不变'
  return field.placeholder ?? `请输入 ${field.label}`
}

async function load(): Promise<void> {
  values.value = {}
  filled.value = {}
  if (props.plugin.loadError || !props.plugin.hasEnv) {
    fields.value = []
    return
  }
  loading.value = true
  const result = await pluginApi.getEnv(props.plugin.id)
  loading.value = false
  if (!result.ok) {
    fields.value = []
    MessagePlugin.error(`读取「${props.plugin.name}」的环境变量失败：${result.message}`)
    return
  }
  fields.value = result.data.fields
  filled.value = result.data.filled
}

async function save(): Promise<void> {
  const payload = Object.fromEntries(
    Object.entries(values.value).filter(([, value]) => value.length > 0)
  )
  if (Object.keys(payload).length === 0) {
    MessagePlugin.warning('没有填写任何内容')
    return
  }
  saving.value = true
  const result = await pluginApi.saveEnv(props.plugin.id, { values: payload })
  saving.value = false
  if (!result.ok) {
    MessagePlugin.error(`保存「${props.plugin.name}」失败：${result.message}`)
    return
  }
  MessagePlugin.success(`「${props.plugin.name}」的环境变量已保存`)
  emit('saved', result.data)
  await load()
}

watch(() => props.plugin.id, () => void load(), { immediate: true })
</script>

<template>
  <section class="config-panel">
    <div class="panel-head">
      <span class="panel-title">配置</span>
      <t-tag
        v-if="fields.length > 0"
        :theme="plugin.envReady ? 'success' : 'warning'"
        variant="light"
      >
        {{ plugin.envReady ? '已填写完整' : '存在未填写的必填项' }}
      </t-tag>
      <span class="head-spacer" />
      <t-button size="small" variant="text" :loading="loading" @click="load">刷新</t-button>
    </div>
    <p class="panel-tip">
      环境变量由插件自行声明，保存在 ~/.vault-scrape/plugin/plugins.json（加密存放）
    </p>

    <t-loading :loading="loading" size="small">
      <t-empty
        v-if="fields.length === 0"
        :title="emptyTitle"
        :description="emptyDescription"
      />
      <template v-else>
        <div v-for="field in fields" :key="field.key" class="env-field">
          <div class="field-head">
            <span class="field-label">
              {{ field.label }}
              <span v-if="field.required" class="field-required">必填</span>
            </span>
            <span v-if="filled[field.key]" class="field-saved">已保存</span>
          </div>
          <t-textarea
            v-model="values[field.key]"
            :placeholder="placeholderOf(field, filled[field.key] === true)"
            :autosize="{ minRows: 3, maxRows: 8 }"
          />
          <p v-if="field.description" class="field-desc">{{ field.description }}</p>
        </div>

        <div class="config-footer">
          <t-button size="small" theme="primary" :loading="saving" @click="save">保存</t-button>
        </div>
      </template>
    </t-loading>
  </section>
</template>

<style scoped lang="less">
.config-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 12px;
  border-top: 1px solid var(--fluent-card-border);
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--td-text-color-primary);
}

.head-spacer {
  flex: 1;
}

.panel-tip {
  margin: 0;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.env-field {
  padding: 8px 0;
}

.field-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.field-label {
  font-size: 13px;
  color: var(--td-text-color-primary);
}

.field-required {
  margin-left: 6px;
  font-size: 12px;
  color: var(--td-error-color);
}

.field-saved {
  font-size: 12px;
  color: var(--td-success-color);
}

.field-desc {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.config-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 4px;
}
</style>
