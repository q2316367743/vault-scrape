<template>
  <div class="checkbox-select" :class="{ 'checkbox-select-disabled': disabled }">
    <div class="checkbox-select-search">
      <t-input v-model="keyword" clearable :disabled="disabled" :placeholder="placeholder">
        <template #prefix-icon><search-icon /></template>
      </t-input>
    </div>

    <div class="checkbox-select-list">
      <div
        v-for="item in visibleOptions"
        :key="item.value"
        class="checkbox-select-option"
        :class="{ 'checkbox-select-option-disabled': isDisabled(item) }"
        @click="toggle(item)"
      >
        <t-checkbox
          :checked="selectedValues.has(item.value)"
          :disabled="isDisabled(item)"
          @click.stop="toggle(item)"
        />
        <span class="checkbox-select-label">{{ item.label }}</span>
      </div>
      <p v-if="visibleOptions.length === 0" class="checkbox-select-empty">{{ emptyText }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 多选控件：外框 + 顶部搜索 + 可滚动的 checkbox 列表（样式与 `t-select` 的选项一致：label / value / disabled）。
 *
 * 契约：
 * - `v-model` 是**字符串数组**，只增删数组元素，不改元素本身的顺序；
 * - **不在 `options` 里的值会被保留**：调用方可能把当前不可用的历史值传进来展示（例如已失效的插件 id），
 *   这里不能因为搜索过滤或点击就把它们静默丢掉；
 * - `disabled` 的选项点击无效，只有 `disabled` 的选项或整体 `disabled` 才不可勾选；
 * - 点击整行、点 checkbox 都是同一个 `toggle`，checkbox 自己 `@click.stop` 防止触发两次。
 */
import { computed, ref } from 'vue'
import { SearchIcon } from 'tdesign-icons-vue-next'

interface CheckboxSelectOption {
  label: string
  value: string
  disabled?: boolean
}

const props = withDefaults(
  defineProps<{
    /** 已选值，字符串数组 */
    modelValue: string[]
    /** 候选项，与 `t-select` 的选项结构一致 */
    options: CheckboxSelectOption[]
    /** 搜索框占位文案 */
    placeholder?: string
    /** 整体禁用 */
    disabled?: boolean
  }>(),
  { placeholder: '搜索', disabled: false }
)

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
  change: [value: string[]]
}>()

const keyword = ref('')

const selectedValues = computed(() => new Set(props.modelValue))

/** 搜索只过滤展示，不影响已选值 */
const visibleOptions = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (text.length === 0) return props.options
  return props.options.filter((item) => item.label.toLowerCase().includes(text))
})

const emptyText = computed(() =>
  keyword.value.trim().length > 0 ? '没有匹配的选项' : '暂无可选项'
)

function isDisabled(item: CheckboxSelectOption): boolean {
  return props.disabled || item.disabled === true
}

/** 单选态切换：已选则移除，未选则追加；非字符串值由类型挡在外面 */
function toggle(item: CheckboxSelectOption): void {
  if (isDisabled(item)) return
  const next = [...props.modelValue]
  const index = next.indexOf(item.value)
  if (index >= 0) next.splice(index, 1)
  else next.push(item.value)
  emit('update:modelValue', next)
  emit('change', next)
}
</script>

<style scoped lang="less">
.checkbox-select {
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-medium);
  background-color: var(--td-bg-color-container);
  overflow: hidden;
  transition: border-color 0.2s;

  &:focus-within {
    border-color: var(--td-brand-color);
  }
}

.checkbox-select-disabled {
  background-color: var(--td-bg-color-container-hover);
}

.checkbox-select-search {
  padding: 6px;

  // 搜索框去掉自己的描边：外框已经表达「输入区」，避免框里有框
  :deep(.t-input.t-input) {
    box-shadow: none;
    background-color: transparent;
  }
}

.checkbox-select-list {
  max-height: 220px;
  overflow-y: auto;
  padding: 0 6px 6px;
  border-top: 1px solid var(--td-component-stroke);
}

.checkbox-select-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--td-radius-small);
  cursor: pointer;

  &:hover {
    background-color: var(--td-bg-color-container-hover);
  }
}

.checkbox-select-option-disabled {
  cursor: not-allowed;

  .checkbox-select-label {
    color: var(--td-text-color-disabled);
  }
}

.checkbox-select-label {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--td-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.checkbox-select-empty {
  margin: 12px 0;
  text-align: center;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}
</style>
