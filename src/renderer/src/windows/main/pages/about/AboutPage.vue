<script setup lang="ts">
import { version as vueVersion } from 'vue'
import PageLayout from '@/components/PageLayout/PageLayout.vue'

const versions = window.electron.process.versions

/** 关于页版本信息：应用信息 + 运行时版本 */
const rows = [
  { label: '应用名称', value: 'vault-scrape' },
  { label: '应用说明', value: '本地影视刮削工具' },
  { label: '运行平台', value: `${window.electron.process.platform} ${versions.arch ?? ''}`.trim() },
  { label: 'Electron', value: versions.electron },
  { label: 'Chromium', value: versions.chrome },
  { label: 'Node.js', value: versions.node },
  { label: 'V8', value: versions.v8 },
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
