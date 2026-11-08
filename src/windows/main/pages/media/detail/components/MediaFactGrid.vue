<template>
  <dl class="fact-grid">
    <div v-for="cell in cells" :key="cell.label" class="fact-cell">
      <dt>{{ cell.label }}</dt>
      <dd>{{ cell.value }}</dd>
    </div>
  </dl>
</template>
<script setup lang="ts">
/**
 * 信息格：把 `DetailCell[]` 渲染成「左标签右值」的说明列表。
 *
 * 契约：纯展示，不取数；标签列定宽，长值自己换行，窄容器里也不会撑破版面。
 */
import type { DetailCell } from '../mediaDetailCells'

defineProps<{ cells: DetailCell[] }>()
</script>

<style scoped lang="less">
.fact-grid {
  display: flex;
  flex-direction: column;
  margin: 0;
}

.fact-cell {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 12px;
  padding: 5px 0;
}

.fact-cell dt {
  font-size: 13px;
  color: var(--td-text-color-placeholder);
}

.fact-cell dd {
  margin: 0;
  font-size: 13px;
  color: var(--td-text-color-primary);
  word-break: break-word;
}
</style>
