<script setup lang="ts">
import PageLayout from '@/components/PageLayout/PageLayout.vue'
</script>

<template>
  <page-layout title="工具" description="独立的辅助功能">
    <t-card :bordered="false" class="tools-card">
      <t-empty title="暂无工具" description="后续在此提供重命名、清理、校验等独立工具" />
    </t-card>
  </page-layout>
</template>

<style scoped lang="less">
.tools-card {
  border-radius: var(--td-radius-large);
}
</style>
