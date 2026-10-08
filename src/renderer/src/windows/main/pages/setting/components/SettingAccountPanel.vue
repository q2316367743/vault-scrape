<script setup lang="ts">
/**
 * 账号设置：集中填写各插件声明的环境变量。
 *
 * 契约：
 * - 环境变量一律是多行文本（Cookie、Token 这类值本身就可能很长），统一按敏感值处理；
 * - 已保存的值不回显，文本域留空即表示「保持已保存的值」；
 * - 保存以插件为单位，只提交本次填写的项。
 */
import { onMounted, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import type { PluginEnvField, PluginSummary } from '@common/types/plugin'
import { pluginApi } from '@/api'

interface EnvSection {
  plugin: PluginSummary
  fields: PluginEnvField[]
  filled: Record<string, boolean>
  values: Record<string, string>
  saving: boolean
}

const loading = ref(false)
const sections = ref<EnvSection[]>([])

function placeholderOf(field: PluginEnvField, filled: boolean): string {
  if (filled) return '已保存，留空表示保持不变'
  return field.placeholder ?? `请输入 ${field.label}`
}

async function loadSection(plugin: PluginSummary): Promise<EnvSection | null> {
  const result = await pluginApi.getEnv(plugin.id)
  if (!result.ok) {
    MessagePlugin.error(`读取「${plugin.name}」的环境变量失败：${result.message}`)
    return null
  }
  return {
    plugin,
    fields: result.data.fields,
    filled: result.data.filled,
    values: {},
    saving: false
  }
}

async function refresh(): Promise<void> {
  loading.value = true
  const result = await pluginApi.list()
  if (!result.ok) {
    loading.value = false
    MessagePlugin.error(`读取插件列表失败：${result.message}`)
    return
  }
  const withEnv = result.data.filter((plugin) => plugin.hasEnv && plugin.loadError.length === 0)
  const loaded = await Promise.all(withEnv.map(loadSection))
  sections.value = loaded.filter((item): item is EnvSection => item !== null)
  loading.value = false
}

async function save(section: EnvSection): Promise<void> {
  const filled = Object.fromEntries(
    Object.entries(section.values).filter(([, value]) => value.length > 0)
  )
  if (Object.keys(filled).length === 0) {
    MessagePlugin.warning('没有填写任何内容')
    return
  }
  section.saving = true
  const result = await pluginApi.saveEnv(section.plugin.id, { values: filled })
  section.saving = false
  if (!result.ok) {
    MessagePlugin.error(`保存「${section.plugin.name}」失败：${result.message}`)
    return
  }
  MessagePlugin.success(`「${section.plugin.name}」的环境变量已保存`)
  section.values = {}
  const reloaded = await loadSection(result.data)
  if (reloaded) sections.value = sections.value.map((item) => (item === section ? reloaded : item))
}

onMounted(refresh)
</script>

<template>
  <div class="account-panel">
    <div class="panel-head">
      <span class="head-tip">
        环境变量由插件自行声明，保存在 ~/.vault-scrape/plugin/plugins.json（加密存放）
      </span>
      <t-button size="small" variant="outline" :loading="loading" @click="refresh">刷新</t-button>
    </div>

    <t-empty
      v-if="!loading && sections.length === 0"
      title="没有需要填写的环境变量"
      description="导入的插件若声明了 env，就会出现在这里"
    />

    <t-card v-for="section in sections" :key="section.plugin.id" class="env-card" :bordered="true">
      <template #title>
        <span class="card-title">{{ section.plugin.name }}</span>
        <span class="card-sub">{{ section.plugin.id }} · v{{ section.plugin.version }}</span>
      </template>
      <template #actions>
        <t-tag v-if="section.plugin.envReady" theme="success" variant="light">已填写完整</t-tag>
        <t-tag v-else theme="warning" variant="light">存在未填写的必填项</t-tag>
      </template>

      <div v-for="field in section.fields" :key="field.key" class="env-field">
        <div class="field-head">
          <span class="field-label">
            {{ field.label }}
            <span v-if="field.required" class="field-required">必填</span>
          </span>
          <span v-if="section.filled[field.key]" class="field-saved">已保存</span>
        </div>
        <t-textarea
          v-model="section.values[field.key]"
          :placeholder="placeholderOf(field, section.filled[field.key] === true)"
          :autosize="{ minRows: 3, maxRows: 8 }"
        />
        <p v-if="field.description" class="field-desc">{{ field.description }}</p>
      </div>

      <template #footer>
        <div class="card-footer">
          <t-button size="small" theme="primary" :loading="section.saving" @click="save(section)">
            保存
          </t-button>
        </div>
      </template>
    </t-card>
  </div>
</template>

<style scoped lang="less">
.account-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.head-tip {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.env-card {
  background: var(--td-bg-color-container);
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--td-text-color-primary);
}

.card-sub {
  margin-left: 8px;
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

.card-footer {
  display: flex;
  justify-content: flex-end;
}
</style>
