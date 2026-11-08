<script setup lang="ts">
import { version as vueVersion } from 'vue'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import { appInfo } from '@/api'

const info = appInfo()

/** 关于页版本信息：插件信息 + 运行时版本（插件里没有 Electron / Chromium 版本） */
const rows = [
  { label: '应用名称', value: info.pluginName || '刮削' },
  { label: '应用说明', value: '本地影视刮削工具' },
  { label: '插件版本', value: info.pluginVersion },
  { label: '插件 ID', value: info.pluginId },
  { label: '运行平台', value: info.platform },
  { label: 'Node.js', value: info.nodeVersion },
  { label: 'Vue', value: vueVersion }
]
</script>

<template>
  <page-layout title="关于" description="版本与运行环境信息">
    <t-card :bordered="false" class="about-card">
      <t-list split size="small">
        <t-list-item v-for="row in rows" :key="row.label">
          <t-list-item-meta :title="row.label" />
          <template #action>
            <span class="about-value">{{ row.value }}</span>
          </template>
        </t-list-item>
      </t-list>
    </t-card>
  </page-layout>
</template>

<style scoped lang="less">
.about-card {
  border-radius: var(--td-radius-large);
}

.about-value {
  color: var(--td-text-color-secondary);
}
</style>
