<script setup lang="ts">
/**
 * 插件连接的动态配置字段：按插件声明的字段表渲染。
 *
 * 契约：
 * - secret 字段用密码框且不回显（值不在连接对象里），留空表示保持已存值；
 * - 其余字段普通输入框，值全量提交；
 * - 字段的 key / label / placeholder / description 全部来自插件声明，本组件不感知具体网盘。
 */
import { computed } from 'vue'
import type { PluginEnvField } from '@common/types/plugin'

const props = defineProps<{
  /** 插件声明的连接配置字段 */
  fields: PluginEnvField[]
}>()

const value = defineModel<Record<string, string>>({ required: true })

function fieldValue(field: PluginEnvField): string {
  return value.value[field.key] ?? ''
}

function setField(field: PluginEnvField, input: unknown): void {
  value.value = { ...value.value, [field.key]: typeof input === 'string' ? input : '' }
}

/** 字段下方的一行说明：声明了 description 才显示 */
const hasDescription = computed(() => props.fields.some((field) => field.description))
</script>

<template>
  <div class="plugin-fields">
    <div v-for="field in fields" :key="field.key" class="form-row">
      <span class="form-label" :title="field.key">{{ field.label }}</span>
      <t-input
        class="form-control"
        :type="field.secret === true ? 'password' : 'text'"
        :value="fieldValue(field)"
        :placeholder="field.placeholder || (field.secret === true ? '留空表示保持已保存的值' : '')"
        @update:value="(input: unknown) => setField(field, input)"
      />
    </div>
    <p v-if="hasDescription" class="fields-note">
      {{ fields.filter((field) => field.description).map((field) => field.description).join('；') }}
    </p>
  </div>
</template>

<style scoped lang="less">
.plugin-fields {
  width: 100%;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.form-label {
  width: 76px;
  flex-shrink: 0;
  font-size: 13px;
  color: var(--td-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.form-control {
  flex: 1;
}

.fields-note {
  margin: 0 0 4px 88px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--td-text-color-placeholder);
}
</style>
