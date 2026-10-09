<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronRightIcon } from 'tdesign-icons-vue-next'
import type { SideMenuItem } from './types'

const props = withDefaults(defineProps<{ item: SideMenuItem; collapsed?: boolean }>(), {
  collapsed: false
})

const route = useRoute()
const router = useRouter()

function isSelfActive(item: SideMenuItem): boolean {
  if (!item.to) return false
  if (item.activePaths && item.activePaths.length > 0) return item.activePaths.includes(route.path)
  return item.match === 'prefix' ? route.path.startsWith(item.to) : route.path === item.to
}

function hasActiveDescendant(item: SideMenuItem): boolean {
  return (item.children ?? []).some((child) => isSelfActive(child) || hasActiveDescendant(child))
}

const active = computed(() => isSelfActive(props.item))
const expanded = ref(hasActiveDescendant(props.item))

function onNodeClick(): void {
  const children = props.item.children ?? []
  if (children.length > 0) {
    // 折叠态是图标轨道，没有展示子菜单的空间，点击分组不做任何事（当前菜单只有一级项）
    if (props.collapsed) return
    expanded.value = !expanded.value
    return
  }
  if (props.item.to) void router.push(props.item.to)
}
</script>

<template>
  <t-divider v-if="item.type === 'divider'" size="8px" />
  <div v-else class="menu-node">
    <t-tooltip :content="item.label" placement="right" :disabled="!collapsed">
      <button
        class="menu-item"
        :class="{ 'is-active': active, 'is-expanded': expanded, 'is-collapsed': collapsed }"
        type="button"
        @click="onNodeClick"
      >
        <span v-if="item.icon" class="menu-icon">
          <component :is="item.icon" />
        </span>
        <span class="menu-label">{{ item.label }}</span>
        <chevron-right-icon v-if="item.children?.length" class="menu-arrow" />
      </button>
    </t-tooltip>
    <div
      v-if="item.children?.length && !collapsed"
      class="menu-children"
      :class="{ 'is-open': expanded }"
    >
      <side-menu-node v-for="child in item.children" :key="child.label" :item="child" />
    </div>
  </div>
</template>

<style scoped lang="less">
.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: none;
  border-radius: var(--td-radius-default);
  background: transparent;
  color: var(--td-text-color-primary);
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  transition: background var(--fluent-transition-fast);

  &:hover {
    background: var(--fluent-item-hover);
  }

  &:focus-visible {
    outline: 2px solid var(--fluent-focus-ring);
    outline-offset: -2px;
  }

  &.is-active {
    background: var(--fluent-item-selected);
    //box-shadow: inset 3px 0 0 var(--fluent-item-selected-border);
  }

  // 折叠态：只留居中图标，文字与箭头交给 t-tooltip 承载
  &.is-collapsed {
    justify-content: center;
    padding: 0;
  }
}

.menu-item.is-collapsed .menu-label,
.menu-item.is-collapsed .menu-arrow {
  display: none;
}

.menu-icon {
  display: inline-flex;
  font-size: 16px;
  color: var(--td-text-color-secondary);
}

.is-active .menu-icon {
  color: var(--td-brand-color);
}

.menu-label {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.menu-arrow {
  font-size: 16px;
  color: var(--td-text-color-placeholder);
  transition: transform var(--fluent-transition-fast);
}

.is-expanded .menu-arrow {
  transform: rotate(90deg);
}

.menu-children {
  max-height: 0;
  overflow: hidden;
  transition: max-height var(--fluent-transition-normal);
}

.menu-children.is-open {
  max-height: 360px;
}

.menu-children :deep(.menu-item) {
  padding-left: 34px;
}
</style>
