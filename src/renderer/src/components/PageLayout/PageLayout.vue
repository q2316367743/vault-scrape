<script setup lang="ts">
defineProps<{
  /** 页面标题 */
  title: string
  /** 标题右侧的补充说明 */
  description?: string
}>()
</script>

<template>
  <div class="page-layout">
    <header class="page-header">
      <div class="page-heading">
        <h2 class="page-title">{{ title }}</h2>
        <span v-if="description" class="page-description">{{ description }}</span>
      </div>
      <div class="page-extra">
        <slot name="extra" />
      </div>
    </header>
    <div class="page-container">
      <slot />
    </div>
  </div>
</template>

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
  align-items: baseline;
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
}
</style>
