<script setup lang="ts">
import SideMenuNode from './SideMenuNode.vue'
import type { SideMenuItem } from './types'

withDefaults(defineProps<{ items: SideMenuItem[]; collapsed?: boolean }>(), { collapsed: false })
</script>

<template>
  <nav class="menu-list">
    <side-menu-node
      v-for="item in items"
      :key="item.label"
      :item="item"
      :collapsed="collapsed"
    />
  </nav>
</template>

<style scoped lang="less">
.menu-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  padding: 4px 8px 12px;
  overflow-y: auto;
}
</style>
