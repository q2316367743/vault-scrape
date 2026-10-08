<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { MessagePlugin } from 'tdesign-vue-next'
import { FolderOpenIcon } from 'tdesign-icons-vue-next'
import { useSettingPathStore } from '@/windows/main/store'

const { setting } = storeToRefs(useSettingPathStore())

/** TODO: 接入主进程目录选择对话框后替换为真实选择逻辑 */
function pickDirectory(): void {
  MessagePlugin.info('目录选择待接入，请先手动输入绝对路径')
}
</script>

<template>
  <t-list class="setting-list" split size="small">
    <t-list-item>
      <t-list-item-meta title="演员头像目录" description="演员头像图片的根目录，留空使用默认位置" />
      <template #action>
        <div class="setting-field">
          <t-input v-model="setting.actorAvatarDir" placeholder="留空使用默认位置" allow-clear />
          <t-button theme="default" variant="outline" @click="pickDirectory">
            <template #icon><folder-open-icon /></template>
            选择
          </t-button>
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="成功输出目录" description="刮削成功后影片的存放目录" />
      <template #action>
        <div class="setting-field">
          <t-input v-model="setting.successOutputDir" placeholder="留空使用原目录" allow-clear />
          <t-button theme="default" variant="outline" @click="pickDirectory">
            <template #icon><folder-open-icon /></template>
            选择
          </t-button>
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="失败输出目录" description="刮削失败后影片的存放目录" />
      <template #action>
        <div class="setting-field">
          <t-input v-model="setting.failedOutputDir" placeholder="留空使用原目录" allow-clear />
          <t-button theme="default" variant="outline" @click="pickDirectory">
            <template #icon><folder-open-icon /></template>
            选择
          </t-button>
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="剧照目录名" description="刮削结果中存放剧照的子目录名" />
      <template #action>
        <div class="setting-field">
          <t-input v-model="setting.fanartDirName" placeholder="extrafanart" allow-clear />
        </div>
      </template>
    </t-list-item>
  </t-list>
</template>
