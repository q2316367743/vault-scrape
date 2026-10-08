<script setup lang="ts">
import PageLayout from '@/components/PageLayout/PageLayout.vue'
</script>

<template>
  <page-layout title="工作台" description="选择目录并启动刮削任务">
    <t-card :bordered="false" class="workspace-card">
      <t-empty title="刮削流程尚未接入" description="后续在此配置待刮削目录、预览识别结果并启动任务" />
    </t-card>
  </page-layout>
</template>

<style scoped lang="less">
.workspace-card {
  border-radius: var(--td-radius-large);
}
</style>
