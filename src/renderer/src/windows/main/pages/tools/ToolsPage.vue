<script setup lang="ts">
/**
 * 工具箱索引页：登记在 `toolRegistry.ts` 里的工具在这里列成入口卡片，点击进入各自的工具页。
 *
 * 契约：索引页不做业务，只按注册表渲染入口并跳转。
 */
import { useRouter } from 'vue-router'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import { toolEntries } from './toolRegistry'

const router = useRouter()

function open(path: string): void {
  void router.push(path)
}
</script>

<template>
  <page-layout title="工具" description="按功能进入独立工具页；工具需要插件时，在工具页里选择用哪个插件">
    <div class="tool-grid">
      <t-card
        v-for="entry in toolEntries"
        :key="entry.key"
        class="tool-card"
        :bordered="false"
        hover-shadow
        @click="open(entry.path)"
      >
        <div class="tool-head">
          <span class="tool-icon"><component :is="entry.icon" /></span>
          <span class="tool-name">{{ entry.name }}</span>
        </div>
        <p class="tool-desc">{{ entry.description }}</p>
      </t-card>
    </div>
  </page-layout>
</template>

<style scoped lang="less">
.tool-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

.tool-card {
  cursor: pointer;
  background: var(--td-bg-color-container);
  border-radius: var(--td-radius-large);
}

.tool-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tool-icon {
  display: flex;
  align-items: center;
  font-size: 18px;
  color: var(--td-brand-color);
}

.tool-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--td-text-color-primary);
}

.tool-desc {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--td-text-color-placeholder);
}
</style>
