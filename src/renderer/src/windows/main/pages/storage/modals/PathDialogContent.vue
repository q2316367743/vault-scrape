<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    label: string
    defaultValue?: string
    placeholder?: string
    hint?: string
    confirmText?: string
    withOverwrite?: boolean
  }>(),
  { defaultValue: '', placeholder: '', hint: '', confirmText: '确定', withOverwrite: false }
)

const emit = defineEmits<{ close: []; success: [path: string, overwrite: boolean] }>()

const value = ref(props.defaultValue)
const overwrite = ref(false)

function onSubmit(): void {
  const target = value.value.trim()
  if (target.length === 0) return
  emit('success', target, overwrite.value)
}
</script>

<template>
  <div class="path-dialog">
    <div class="dialog-row">
      <span class="dialog-label">{{ label }}</span>
      <t-input
        v-model="value"
        class="dialog-control"
        autofocus
        :placeholder="placeholder"
        @enter="onSubmit"
      />
    </div>
    <p v-if="hint.length > 0" class="dialog-hint">{{ hint }}</p>

    <label v-if="withOverwrite" class="dialog-overwrite">
      <t-switch v-model="overwrite" size="small" />
      <span>目标已存在时覆盖</span>
    </label>

    <footer class="dialog-actions">
      <t-button variant="outline" @click="emit('close')">取消</t-button>
      <t-button theme="primary" :disabled="value.trim().length === 0" @click="onSubmit">
        {{ confirmText }}
      </t-button>
    </footer>
  </div>
</template>

<style scoped lang="less">
.dialog-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
}

.dialog-label {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--td-text-color-secondary);
}

.dialog-control {
  flex: 1;
}

.dialog-hint {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--td-text-color-placeholder);
}

.dialog-overwrite {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  font-size: 13px;
  color: var(--td-text-color-secondary);
  cursor: pointer;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 24px;
}
</style>
