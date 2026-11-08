<template>
  <div class="radio-select" :class="{ 'radio-select-disabled': disabled }">
    <div class="radio-select-search">
      <t-input v-model="keyword" clearable :disabled="disabled" :placeholder="placeholder">
        <template #prefix-icon><search-icon /></template>
      </t-input>
    </div>

    <div class="radio-select-list">
      <div
        v-for="item in visibleOptions"
        :key="item.value"
        class="radio-select-option"
        :class="{ 'radio-select-option-disabled': isDisabled(item) }"
        @click="select(item)"
      >
        <t-radio
          :checked="modelValue === item.value"
          :disabled="isDisabled(item)"
          @click.stop="select(item)"
        />
        <div class="radio-select-text">
          <span class="radio-select-label">{{ item.label }}</span>
          <span v-if="item.description" class="radio-select-description">
            {{ item.description }}
          </span>
        </div>
      </div>
      <p v-if="visibleOptions.length === 0" class="radio-select-empty">{{ emptyText }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 单选控件：外框 + 顶部搜索 + 可滚动的 radio 列表（与 `CheckboxSelect` 同一套外观，`t-select` 的选项结构）。
 *
 * 契约：
 * - `v-model` 是**字符串**（单个值），空串表示「还没选」；
 * - **不在 `options` 里的值不会被清掉**：调用方可能把当前不可用的历史值传进来（例如已失效的插件 id），
 *   这时列表里没有任何一项被选中，但值一直留着，直到用户点了别的选项才被替换；
 * - 选项可以带一行 `description`（灰字说明，例如「未启用」「需要先补全插件设置」），
 *   搜索同时匹配 `label` 与 `description`；
 * - `disabled` 的选项点击无效，只有 `disabled` 的选项或整体 `disabled` 才不可选；
 * - 点击整行、点 radio 都是同一个 `select`，radio 自己 `@click.stop` 防止触发两次；
 *   radio 本身点了不取消（单选没有「取消选中」语义）。
 */
import { computed, ref } from 'vue'
import { SearchIcon } from 'tdesign-icons-vue-next'

interface RadioSelectOption {
  label: string
  value: string
  disabled?: boolean
  /** 选项下方的灰字说明，可省 */
  description?: string
}

const props = withDefaults(
  defineProps<{
    /** 已选值，空串表示未选 */
    modelValue: string
    /** 候选项，与 `t-select` 的选项结构一致，多了可选的 `description` */
    options: RadioSelectOption[]
    /** 搜索框占位文案 */
    placeholder?: string
    /** 整体禁用 */
    disabled?: boolean
  }>(),
  { placeholder: '搜索', disabled: false }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

const keyword = ref('')

/** 搜索只过滤展示，不影响已选值 */
const visibleOptions = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (text.length === 0) return props.options
  return props.options.filter(
    (item) =>
      item.label.toLowerCase().includes(text) ||
      (item.description ?? '').toLowerCase().includes(text)
  )
})

const emptyText = computed(() =>
  keyword.value.trim().length > 0 ? '没有匹配的选项' : '暂无可选项'
)

function isDisabled(item: RadioSelectOption): boolean {
  return props.disabled || item.disabled === true
}

/** 选中一项：已选中的再点一次保持原样，不做取消 */
function select(item: RadioSelectOption): void {
  if (isDisabled(item) || item.value === props.modelValue) return
  emit('update:modelValue', item.value)
  emit('change', item.value)
}
</script>

<style scoped lang="less">
.radio-select {
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-medium);
  background-color: var(--td-bg-color-container);
  overflow: hidden;
  transition: border-color 0.2s;

  &:focus-within {
    border-color: var(--td-brand-color);
  }
}

.radio-select-disabled {
  background-color: var(--td-bg-color-container-hover);
}

.radio-select-search {
  padding: 6px;

  // 搜索框去掉自己的描边：外框已经表达「输入区」，避免框里有框
  :deep(.t-input.t-input) {
    box-shadow: none;
    background-color: transparent;
  }
}

.radio-select-list {
  max-height: 220px;
  overflow-y: auto;
  padding: 6px;
  border-top: 1px solid var(--td-component-stroke);
}

.radio-select-option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--td-radius-small);
  cursor: pointer;

  &:hover {
    background-color: var(--td-bg-color-container-hover);
  }

  // radio 图标与首行文字对齐（带说明时整体是两行）
  :deep(.t-radio) {
    margin-top: 1px;
  }
}

.radio-select-option-disabled {
  cursor: not-allowed;

  .radio-select-label {
    color: var(--td-text-color-disabled);
  }
}

.radio-select-text {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.radio-select-label {
  font-size: 13px;
  color: var(--td-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.radio-select-description {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.radio-select-empty {
  margin: 12px 0;
  text-align: center;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}
</style>
