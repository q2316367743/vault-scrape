<script setup lang="ts">
import { onMounted, ref } from 'vue'

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
    <footer class="editor-actions">
      <t-button variant="outline" :disabled="saving" @click="emit('close')">取消</t-button>
      <t-button theme="primary" :loading="saving" :disabled="loading" @click="onSave">保存</t-button>
    </footer>
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

.editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
