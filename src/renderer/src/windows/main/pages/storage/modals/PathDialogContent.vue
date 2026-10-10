<script setup lang="ts">
/**
 * 单路径输入弹窗的内容组件（外壳见同目录 PathDialog.tsx）。
 *
 * 输入、「非空才可提交」与覆盖开关都在这里，取消 / 确定按钮在外壳 footer；
 * 这里用 `defineExpose` 把提交动作与可提交状态交出去（见 `@/utils/modal/ModalContent`）。
 */
import { computed, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    label: string
    defaultValue?: string
    placeholder?: string
    hint?: string
    withOverwrite?: boolean
  }>(),
  { defaultValue: '', placeholder: '', hint: '', withOverwrite: false }
)

const emit = defineEmits<{ success: [path: string, overwrite: boolean] }>()

const value = ref(props.defaultValue)
const overwrite = ref(false)
const canSubmit = computed(() => value.value.trim().length > 0)

function onSubmit(): void {
  const target = value.value.trim()
  if (target.length === 0) return
  emit('success', target, overwrite.value)
}

/** 交给外壳 footer 的取消 / 确定按钮；回车同样走 submit */
defineExpose({ submit: onSubmit, canSubmit })
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
</style>
