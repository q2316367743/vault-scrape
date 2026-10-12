<script setup lang="ts">
import { MenuFoldIcon, MenuUnfoldIcon } from 'tdesign-icons-vue-next'
import AppPlayerBadge from '@/components/app/AppPlayerBadge.vue'
import AppTitleBar from '@/components/app/AppTitleBar.vue'
import { collapsed, toggleCollapsed } from '@/global/AppState'
import { useOfflineUpdateNotice } from './composables/useOfflineUpdateNotice'
import AppSide from './pages/app/AppSide.vue'

// 启动时若发现离线数据包有新版本，用一条提示告知（不自动下载）
useOfflineUpdateNotice()
</script>

<template>
  <div class="shell">
    <app-title-bar>
      <template #leading>
        <t-tooltip :content="collapsed ? '展开侧栏' : '收起侧栏'" placement="bottom">
          <t-button
            class="bar-toggle"
            variant="text"
            :aria-label="collapsed ? '展开侧栏' : '收起侧栏'"
            @click="toggleCollapsed"
          >
            <menu-unfold-icon v-if="collapsed" />
            <menu-fold-icon v-else />
          </t-button>
        </t-tooltip>
      </template>
      <template #afterTitle>
        <!-- 有播放窗口时紧挨产品名显示「正在播放什么」，点击聚焦播放窗口 -->
        <app-player-badge />
      </template>
    </app-title-bar>
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
  background: var(--td-bg-color-container);
  border: 1px solid var(--fluent-card-border);
  border-radius: var(--td-radius-medium);
}

.bar-toggle {
  width: 32px;
  height: 32px;
  padding: 0;
}
</style>
