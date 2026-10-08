<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    label: string
    defaultValue?: string
    placeholder?: string
    confirmText?: string
  }>(),
  { defaultValue: '', placeholder: '', confirmText: '确定' }
)

const emit = defineEmits<{ close: []; success: [name: string] }>()

const value = ref(props.defaultValue)

function onSubmit(): void {
  const name = value.value.trim()
  if (name.length === 0) return
  emit('success', name)
}
</script>

<template>
  <div class="entry-name-dialog">
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

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 24px;
}
</style>
