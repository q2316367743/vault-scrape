<script setup lang="ts">
import AppTitleBar from './pages/app/AppTitleBar.vue'
import AppSide from './pages/app/AppSide.vue'
</script>

<template>
  <div class="shell">
    <app-title-bar />
    <t-layout class="main">
      <app-side />
      <t-content class="main-container">
        <router-view />
      </t-content>
    </t-layout>
  </div>
</template>

<style scoped lang="less">
// 窗口本身透出系统材质，外壳不铺底色，只把内容面板叠在材质之上
.shell {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: transparent;
}

.main {
  flex: 1;
  min-height: 0;
  background: transparent;
}

.main-container {
  overflow: hidden;
  background: var(--fluent-acrylic-bg);
  border: 1px solid var(--fluent-card-border);
  border-radius: var(--td-radius-medium);
}
</style>
