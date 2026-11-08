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
        description="总开关：开启后，资料库里标记为 NSFW 的内容会隐藏列表、搜索与详情页的敏感图片；关闭时一律显示"
      />
      <template #action>
        <div class="setting-field"><t-switch v-model="setting.nsfwProtection" /></div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta
        title="演员图片目录"
        description="演员头像与图集的保存位置，留空表示使用默认位置"
      />
      <template #action>
        <directory-picker-field
          v-model="setting.actorImageDir"
          class="setting-field"
          title="选择演员图片目录"
          placeholder="留空使用默认位置"
        />
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta
        title="播放器"
        description="影片统一使用内置播放器播放，不依赖本机安装的播放软件"
      />
      <template #action>
        <div class="setting-field"><t-tag variant="light">内置播放器</t-tag></div>
      </template>
    </t-list-item>
  </t-list>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { setThemeMode, themeMode, type ThemeMode } from '@/global/AppTheme'
import DirectoryPickerField from '@/components/DirectoryPickerField.vue'
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
</script>
