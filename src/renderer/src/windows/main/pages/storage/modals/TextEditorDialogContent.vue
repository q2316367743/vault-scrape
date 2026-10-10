<script setup lang="ts">
/**
 * 纯文本编辑器弹窗的内容组件（外壳见同目录 TextEditorDialog.tsx）。
 *
 * 读取、写入与 loading / saving 状态都在这里；取消 / 保存按钮在外壳 footer，
 * 这里用 `defineExpose` 把动作与状态交出去（见 `@/utils/modal/ModalContent`），
 * 加载失败与保存成功由本组件 `emit('close')` 请外壳关闭。
 */
import { computed, onMounted, ref } from 'vue'

const props = defineProps<{
  /** 文件名，仅用于提示文案 */
  name: string
  load: () => Promise<string | null>
  save: (content: string) => Promise<boolean>
}>()

const emit = defineEmits<{ close: [] }>()

const content = ref('')
const loading = ref(false)
const saving = ref(false)
/** 加载完成前不允许保存，避免用空内容覆盖原文件 */
const canSubmit = computed(() => !loading.value)

onMounted(async () => {
  loading.value = true
  const text = await props.load()
  loading.value = false
  if (text === null) {
    emit('close')
    return
  }
  content.value = text
})

async function onSave(): Promise<void> {
  saving.value = true
  const ok = await props.save(content.value)
  saving.value = false
  if (ok) emit('close')
}

/** 交给外壳 footer 的取消 / 保存按钮 */
defineExpose({ submit: onSave, saving, canSubmit })
</script>

<template>
  <div class="text-editor">
    <p class="editor-hint">
      保存后整文件覆盖写入「{{ name }}」，SMB 大文件请改用上传，避免一次传输中断后反复重试。
    </p>
    <t-textarea
      v-model="content"
      class="editor-input"
      :autosize="{ minRows: 16, maxRows: 26 }"
      placeholder="文件内容"
    />
  </div>
</template>

<style scoped lang="less">
.editor-hint {
  margin: 0 0 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--td-text-color-placeholder);
}

.editor-input {
  width: 100%;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 12px;
  line-height: 1.6;
}
</style>
