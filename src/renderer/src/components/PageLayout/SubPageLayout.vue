<template>
  <page-layout :title="title" :description="description" :padded="padded">
    <template #leading>
      <t-button
        class="sub-page-back"
        variant="text"
        shape="square"
        aria-label="返回"
        @click="goBack"
      >
        <chevron-left-icon />
      </t-button>
    </template>
    <template #extra>
      <slot name="extra" />
    </template>
    <slot />
  </page-layout>
</template>

<script setup lang="ts">
/**
 * 子页面容器：在 `PageLayout` 的标题左侧固定一枚返回图标按钮，点击回退浏览历史。
 *
 * 契约：props 与 `PageLayout` 一致；返回语义就是 `router.back()`，不认目标路由，
 * 因此子页面不需要自己写返回逻辑，也不要在 `#extra` 里再放返回按钮。
 */
import { useRouter } from 'vue-router'
import { ChevronLeftIcon } from 'tdesign-icons-vue-next'
import PageLayout from './PageLayout.vue'

withDefaults(
  defineProps<{
    /** 页面标题 */
    title: string
    /** 标题右侧的补充说明 */
    description?: string
    /** 内容区是否保留 20px 内边距 */
    padded?: boolean
  }>(),
  { padded: true }
)

const router = useRouter()

function goBack(): void {
  router.back()
}
</script>

<style scoped lang="less">
// 页头是 baseline 对齐，返回按钮自身垂直居中才与标题齐平；负右边距抵消按钮内边距
.sub-page-back {
  align-self: center;
  margin-right: -6px;
}
</style>
