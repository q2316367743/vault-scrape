<script setup lang="ts">
defineProps<{
  /** 指标名 */
  label: string
  /** 指标值 */
  value: number
}>()
</script>

<template>
  <div class="stat-card">
    <span class="stat-label">{{ label }}</span>
    <span class="stat-value">{{ value }}</span>
  </div>
</template>

<style scoped lang="less">
.stat-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid var(--fluent-card-border);
  border-radius: var(--td-radius-large);
  background: var(--td-bg-color-container);
  box-shadow: var(--fluent-elevation-1);
  transition: box-shadow var(--fluent-transition-fast);
}

.stat-card:hover {
  box-shadow: var(--fluent-elevation-2);
}

.stat-label {
  font-size: 12px;
  color: var(--td-text-color-secondary);
}

.stat-value {
  font-size: 24px;
  font-weight: 600;
  color: var(--td-text-color-primary);
}
</style>
