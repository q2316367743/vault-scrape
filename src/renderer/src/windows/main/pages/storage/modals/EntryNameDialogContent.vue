<script setup lang="ts">
/**
 * 单名称输入弹窗的内容组件（外壳见同目录 EntryNameDialog.tsx）。
 *
 * 输入与「非空才可提交」的判断在这里，取消 / 确定按钮在外壳 footer；
 * 这里用 `defineExpose` 把提交动作与可提交状态交出去（见 `@/utils/modal/ModalContent`）。
 */
import { computed, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    label: string
    defaultValue?: string
    placeholder?: string
  }>(),
  { defaultValue: '', placeholder: '' }
)

const emit = defineEmits<{ success: [name: string] }>()

const value = ref(props.defaultValue)
const canSubmit = computed(() => value.value.trim().length > 0)

function onSubmit(): void {
  const name = value.value.trim()
  if (name.length === 0) return
  emit('success', name)
}

/** 交给外壳 footer 的取消 / 确定按钮；回车同样走 submit */
defineExpose({ submit: onSubmit, canSubmit })
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
</style>
