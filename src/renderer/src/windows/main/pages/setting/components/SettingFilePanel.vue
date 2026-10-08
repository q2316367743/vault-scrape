<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useSettingFileStore } from '@/windows/main/store'

const { setting } = storeToRefs(useSettingFileStore())
</script>

<template>
  <t-list class="setting-list" split size="small">
    <t-list-item>
      <t-list-item-meta title="成功后移动文件" description="刮削成功后移动到成功输出目录" />
      <template #action>
        <div class="setting-field"><t-switch v-model="setting.moveAfterSuccess" /></div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="失败后移动文件" description="刮削失败后移动到失败输出目录" />
      <template #action>
        <div class="setting-field"><t-switch v-model="setting.moveAfterFailure" /></div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="成功后重命名文件" description="按命名规则重命名影片文件" />
      <template #action>
        <div class="setting-field"><t-switch v-model="setting.renameAfterSuccess" /></div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="删除空文件夹" description="刮削结束后清理空的源目录" />
      <template #action>
        <div class="setting-field"><t-switch v-model="setting.removeEmptyFolder" /></div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="刮削软链接目录" description="允许进入符号链接目录进行刮削" />
      <template #action>
        <div class="setting-field"><t-switch v-model="setting.scrapeSymlinkDir" /></div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="保存日志到文件" description="除数据库外同时写入日志文件" />
      <template #action>
        <div class="setting-field"><t-switch v-model="setting.saveLogToFile" /></div>
      </template>
    </t-list-item>
  </t-list>
</template>
