<template>
  <div class="translate-bar">
    <t-radio-group
      :value="showing ? 'translated' : 'original'"
      variant="default-filled"
      size="small"
      :disabled="busy"
      @change="onChange"
    >
      <t-radio-button value="original">原文</t-radio-button>
      <t-radio-button value="translated">译文</t-radio-button>
    </t-radio-group>

    <span class="translate-note">译文语言：{{ language }}</span>

    <t-button
      class="translate-clear"
      variant="text"
      size="small"
      :disabled="busy"
      @click="emit('clear')"
    >
      清除译文
    </t-button>
  </div>
</template>
<script setup lang="ts">
/**
 * 详情页的「原文 / 译文」切换条：只在条目有译文时出现。
 *
 * 契约：
 * - 纯展示 + 只 emit：切换与清除都由页面决定后果，本组件不取数、不写库；
 * - 切换条压在正文最上面（标题与简介都在它下面），切一下整页文字一起换；
 * - 清除只删译文这一份派生物，原文与磁盘文件都不受影响，所以不需要二次确认。
 */
defineProps<{
  /** 现在显示的是哪一份 */
  showing: boolean
  /** 译文语言的中文名 */
  language: string
  /** 翻译中 / 清除中：控件禁用，避免连点 */
  busy: boolean
}>()

const emit = defineEmits<{ change: [showing: boolean]; clear: [] }>()

function onChange(value: unknown): void {
  emit('change', value === 'translated')
}
</script>

<style scoped lang="less">
.translate-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: var(--td-radius-medium);
  background-color: var(--td-bg-color-container-hover);
}

.translate-note {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

/* 清除挂在最右：它跟「切哪一份」不是一类动作，离远一点免得误点 */
.translate-clear {
  margin-left: auto;
}
</style>
