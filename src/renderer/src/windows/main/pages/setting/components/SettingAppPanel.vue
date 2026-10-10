<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { MessagePlugin } from 'tdesign-vue-next'
import { FolderOpenIcon } from 'tdesign-icons-vue-next'
import { setThemeMode, themeMode, type ThemeMode } from '@/global/AppTheme'
import { useSettingAppStore } from '@/windows/main/store'

const { setting } = storeToRefs(useSettingAppStore())

const themeOptions: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: '亮色' },
  { value: 'dark', label: '深色' },
  { value: 'auto', label: '跟随系统' }
]

/** 用字面量收窄，避免断言；取值不合法时忽略 */
function onThemeChange(value: unknown): void {
  if (value === 'light' || value === 'dark' || value === 'auto') setThemeMode(value)
}

/** TODO: 接入主进程目录选择对话框后替换为真实选择逻辑 */
function pickDirectory(): void {
  MessagePlugin.info('目录选择待接入，请先手动输入绝对路径')
}
</script>

<template>
  <t-list class="setting-list" split size="small">
    <t-list-item>
      <t-list-item-meta title="主题" description="亮色、深色或跟随系统，切换后立即生效" />
      <template #action>
        <t-radio-group :value="themeMode" variant="default-filled" @change="onThemeChange">
          <t-radio-button v-for="item in themeOptions" :key="item.value" :value="item.value">
            {{ item.label }}
          </t-radio-button>
        </t-radio-group>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta
        title="NSFW 保护"
        description="开启后，标记为 NSFW 的存储会隐藏列表、搜索与详情页的敏感图片"
      />
      <template #action>
        <div class="setting-field"><t-switch v-model="setting.nsfwProtection" /></div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta
        title="演员头像目录"
        description="刮削到的演员头像保存位置，留空表示使用默认位置"
      />
      <template #action>
        <div class="setting-field">
          <t-input v-model="setting.actorAvatarDir" placeholder="留空使用默认位置" clearable />
          <t-button variant="outline" @click="pickDirectory">
            <template #icon><folder-open-icon /></template>
            选择
          </t-button>
        </div>
      </template>
    </t-list-item>
  </t-list>
</template>
