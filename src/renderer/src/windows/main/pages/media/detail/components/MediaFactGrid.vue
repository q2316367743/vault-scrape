<script setup lang="ts">
/**
 * 信息格：把 `DetailCell[]` 渲染成定义列表。
 *
 * 契约：纯展示，不取数；`wide` 的格子占满整行（长文本、多值字段）。
 */
import type { DetailCell } from '../mediaDetailCells'

defineProps<{ cells: DetailCell[] }>()
</script>

<template>
  <dl class="fact-grid">
    <div v-for="cell in cells" :key="cell.label" class="fact-cell" :class="{ 'is-wide': cell.wide }">
      <dt>{{ cell.label }}</dt>
      <dd>{{ cell.value }}</dd>
    </div>
  </dl>
</template>

<style scoped lang="less">
.fact-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 16px;
  margin: 0;
}

.fact-cell {
  min-width: 0;
}

.fact-cell.is-wide {
  grid-column: 1 / -1;
}

.fact-cell dt {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.fact-cell dd {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--td-text-color-primary);
  word-break: break-word;
}
</style>
