<script setup lang="ts">
import { computed, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { FolderOpenIcon } from 'tdesign-icons-vue-next'
import { dialogApi } from '@/api'

const props = withDefaults(
  defineProps<{
    /** 目录绝对路径，v-model 双向绑定 */
    modelValue: string
    /** 系统选择框标题 */
    title?: string
    placeholder?: string
  }>(),
  { title: '选择目录', placeholder: '' }
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const path = computed({
  get: () => props.modelValue,
  set: (value: string) => emit('update:modelValue', value)
})

/** 选择框处于打开状态时禁用重复点击 */
const picking = ref(false)

/** 唤起系统目录选择框，选中后回填绝对路径；取消或失败都保持原值 */
async function pick(): Promise<void> {
  picking.value = true
  try {
    const result = await dialogApi.open({ title: props.title, directory: true })
    const picked = result.filePaths[0]
    if (result.canceled || !picked) return
    path.value = picked
  } catch {
    MessagePlugin.error('打开系统选择框失败，请手动输入绝对路径')
  } finally {
    picking.value = false
  }
}
</script>

<template>
  <div class="directory-picker">
    <t-input v-model="path" class="directory-picker-input" :placeholder="placeholder" />
    <t-button
      theme="default"
      variant="outline"
      class="directory-picker-button"
      :loading="picking"
      @click="pick"
    >
      <template #icon><folder-open-icon /></template>
      选择
    </t-button>
  </div>
</template>

<style scoped lang="less">
.directory-picker {
  display: flex;
  align-items: center;
  gap: 8px;
}

.directory-picker-input {
  flex: 1;
  min-width: 0;
}

.directory-picker-button {
  flex-shrink: 0;
}
</style>
