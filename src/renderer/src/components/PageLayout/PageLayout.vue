<template>
  <div class="page-layout">
    <header class="page-header">
      <div class="page-heading">
        <slot name="leading" />
        <h2 class="page-title">{{ title }}</h2>
        <span v-if="description" class="page-description">{{ description }}</span>
      </div>
      <div class="page-extra">
        <slot name="extra" />
      </div>
    </header>
    <div class="page-container" :class="{ 'is-flush': !padded }">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    /** 页面标题 */
    title: string
    /** 标题右侧的补充说明 */
    description?: string
    /** 内容区是否保留 20px 内边距；左右分栏页面传 false，改由分栏子组件自己贴边排布 */
    padded?: boolean
  }>(),
  { padded: true }
)
</script>

<style scoped lang="less">
.page-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 56px;
  padding: 0 20px;
  border-bottom: 1px solid var(--td-component-stroke);
}

.page-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.page-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--td-text-color-primary);
}

.page-description {
  font-size: 12px;
  color: var(--td-text-color-secondary);
}

.page-extra {
  display: flex;
  align-items: center;
  gap: 8px;
}

.page-container {
  flex: 1;
  min-height: 0;
  padding: 20px;
  overflow: auto;

  // 左右分栏：内容贴到页面边缘，滚动与内边距交给分栏子组件
  &.is-flush {
    padding: 0;
    overflow: hidden;
  }
}
</style>
