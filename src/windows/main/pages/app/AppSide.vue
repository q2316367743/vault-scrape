<script setup lang="ts">
import {
  DashboardIcon,
  ExtensionIcon,
  FilmIcon,
  HardDiskStorageIcon,
  InfoCircleIcon,
  SettingIcon,
  SystemLogIcon,
  ToolsIcon,
  UserIcon
} from 'tdesign-icons-vue-next'
import SideMenu from '@/components/menu/SideMenu.vue'
import type { SideMenuItem } from '@/components/menu/types'
import { collapsed } from '@/global/AppState'
import { onMounted } from 'vue'
import { themeSystem } from '@/global/AppTheme'

/** 一级菜单：与 router.ts 的九个一级页面一一对应；带子页的项按前缀匹配，子页也保持高亮 */
const menuItems: SideMenuItem[] = [
  { label: '概览', icon: DashboardIcon, to: '/overview', match: 'prefix' },
  { label: '影视墙', icon: FilmIcon, to: '/media', match: 'prefix' },
  { label: '演员', icon: UserIcon, to: '/actor', match: 'prefix' },
  { type: 'divider', label: '' },
  { label: '工具', icon: ToolsIcon, to: '/tools', match: 'prefix' },
  { type: 'divider', label: '' },
  { label: '存储', icon: HardDiskStorageIcon, to: '/storage' },
  { label: '插件', icon: ExtensionIcon, to: '/plugin', match: 'prefix' },
  { type: 'divider', label: '' },
  { label: '设置', icon: SettingIcon, to: '/setting' },
  { label: '日志', icon: SystemLogIcon, to: '/log' },
  { label: '关于', icon: InfoCircleIcon, to: '/about' }
]

onMounted(() => {
  console.log(`当前状态：${themeSystem.value}`)
})
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
