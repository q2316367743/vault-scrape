<script setup lang="ts">
import { MessagePlugin } from 'tdesign-vue-next'

/** 可用占位符：模板里以 {xxx} 形式引用，点击复制 */
const placeholders = [
  { token: '{num}', label: '番号' },
  { token: '{title}', label: '标题' },
  { token: '{actor}', label: '演员' },
  { token: '{actorFallbackPrefix}', label: '演员回退前缀' },
  { token: '{maker}', label: '片商 / 卖家' },
  { token: '{label}', label: '标签' },
  { token: '{series}', label: '系列' },
  { token: '{date}', label: '发行日期' },
  { token: '{year}', label: '年份' },
  { token: '{month}', label: '月份' },
  { token: '{day}', label: '日' },
  { token: '{studio}', label: '制作商' },
  { token: '{director}', label: '导演' },
  { token: '{duration}', label: '时长' },
  { token: '{resolution}', label: '分辨率' },
  { token: '{count}', label: '数量' }
]

async function copyToken(token: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(token)
    MessagePlugin.success(`已复制 ${token}`)
  } catch (error: unknown) {
    MessagePlugin.error(`复制失败：${String(error)}`)
  }
}
</script>

<template>
  <div class="template-hint">
    <span class="template-hint-title">可用占位符（点击复制）</span>
    <div class="template-hint-tags">
      <t-tag
        v-for="item in placeholders"
        :key="item.token"
        class="template-hint-tag"
        variant="light-outline"
        @click="copyToken(item.token)"
      >
        {{ item.token }}
        <span class="template-hint-label">{{ item.label }}</span>
      </t-tag>
    </div>
  </div>
</template>

<style scoped lang="less">
.template-hint {
  margin-bottom: 12px;
}

.template-hint-title {
  font-size: 12px;
  color: var(--td-text-color-secondary);
}

.template-hint-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.template-hint-tag {
  cursor: pointer;
}

.template-hint-label {
  margin-left: 4px;
  color: var(--td-text-color-placeholder);
}
</style>
