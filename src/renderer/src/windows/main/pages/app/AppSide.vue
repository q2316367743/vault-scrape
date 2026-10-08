<script setup lang="ts">
import {
  DashboardIcon,
  DesktopIcon,
  InfoCircleIcon,
  SettingIcon,
  SystemLogIcon,
  ToolsIcon
} from 'tdesign-icons-vue-next'
import SideMenu from '@/components/menu/SideMenu.vue'
import type { SideMenuItem } from '@/components/menu/types'
import { collapsed } from '@/global/AppState'

/** 一级菜单：与 router.ts 的六个页面一一对应 */
const menuItems: SideMenuItem[] = [
  { label: '概览', icon: DashboardIcon, to: '/overview' },
  { label: '工作台', icon: DesktopIcon, to: '/workspace' },
  { label: '工具', icon: ToolsIcon, to: '/tools' },
  { label: '设置', icon: SettingIcon, to: '/setting' },
  { label: '日志', icon: SystemLogIcon, to: '/log' },
  { label: '关于', icon: InfoCircleIcon, to: '/about' }
]
</script>

<template>
  <t-aside class="app-side" :width="collapsed ? '64px' : '224px'">
    <div class="side-inner">
      <side-menu :items="menuItems" :collapsed="collapsed" />
    </div>
  </t-aside>
</template>

<style scoped lang="less">
.app-side {
  flex-shrink: 0;
  overflow: hidden;
  // 侧栏保持透明，直接把窗口的系统亚克力材质透出来
  background: transparent;
  transition: width var(--fluent-transition-normal);
}

.side-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
}
</style>
