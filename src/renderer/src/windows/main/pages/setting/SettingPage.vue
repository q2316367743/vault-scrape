<script setup lang="ts">
import { ref } from 'vue'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import SettingAccountPanel from './components/SettingAccountPanel.vue'
import SettingDownloadPanel from './components/SettingDownloadPanel.vue'
import SettingFilePanel from './components/SettingFilePanel.vue'
import SettingNamingPanel from './components/SettingNamingPanel.vue'
import SettingNetworkPanel from './components/SettingNetworkPanel.vue'
import SettingPathPanel from './components/SettingPathPanel.vue'
import SettingScrapePanel from './components/SettingScrapePanel.vue'
import SettingTranslatePanel from './components/SettingTranslatePanel.vue'

/** 当前分组：value 与 SettingGroupKey 对应，account 为暂未接入的预留分组 */
const active = ref('path')
</script>

<template>
  <page-layout title="设置" description="保存在 ~/.vault-scrape/setting/settings.json，修改后自动保存">
    <t-tabs v-model="active" class="setting-tabs" theme="normal">
      <t-tab-panel value="path" label="目录与路径">
        <setting-path-panel />
      </t-tab-panel>
      <t-tab-panel value="scrape" label="刮削设置">
        <setting-scrape-panel />
      </t-tab-panel>
      <t-tab-panel value="network" label="网络连接">
        <setting-network-panel />
      </t-tab-panel>
      <t-tab-panel value="translate" label="翻译服务">
        <setting-translate-panel />
      </t-tab-panel>
      <t-tab-panel value="naming" label="命名规则">
        <setting-naming-panel />
      </t-tab-panel>
      <t-tab-panel value="download" label="下载选项">
        <setting-download-panel />
      </t-tab-panel>
      <t-tab-panel value="file" label="文件行为">
        <setting-file-panel />
      </t-tab-panel>
      <t-tab-panel value="account" label="账号设置">
        <setting-account-panel />
      </t-tab-panel>
    </t-tabs>
  </page-layout>
</template>

<style scoped lang="less">
.setting-tabs :deep(.t-tab-panel) {
  padding-top: 12px;
}
</style>
