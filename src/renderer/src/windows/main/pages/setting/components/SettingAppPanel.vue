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
        title="mpv 播放器路径"
        description="只有配到 mpv，播放窗口才会用 mpv 播放；留空自动探测，探测不到就用内置播放器（无需任何操作）"
      />
      <template #action>
        <div class="flex flex-col items-end gap-4px">
          <div class="flex items-center gap-8px">
            <t-input v-model="setting.mpvPath" class="w-320px" placeholder="留空自动探测" />
            <t-button variant="outline" @click="onChooseMpv">选择</t-button>
            <t-button variant="outline" :loading="probing" @click="onProbeMpv">检测</t-button>
          </div>
          <t-tag v-if="mpvTip" :theme="mpvTip.theme" variant="light" class="max-w-420px">
            {{ mpvTip.text }}
          </t-tag>
        </div>
      </template>
    </t-list-item>

    <t-list-item v-if="isMac">
      <t-list-item-meta
        title="mpv 画面嵌入窗口（实验）"
        description="仅 macOS：把 mpv 画面嵌进播放窗口；可能出现只有声音没有画面，遇到就关掉它"
      />
      <template #action>
        <div class="setting-field"><t-switch v-model="setting.macEmbed" /></div>
      </template>
    </t-list-item>
  </t-list>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { setThemeMode, themeMode, type ThemeMode } from '@/global/AppTheme'
import DirectoryPickerField from '@/components/DirectoryPickerField.vue'
import { appWindowApi, dialogApi, playerApi } from '@/api'
import { useSettingAppStore } from '@/windows/main/store'

const { setting } = storeToRefs(useSettingAppStore())

/** 红黄绿灯是 macOS 独有的，嵌入开关只在 macOS 上有意义 */
const isMac = appWindowApi.isMac
const probing = ref(false)
/** 探测结果：只在点过「检测」之后显示，免得一进设置页就去跑 mpv */
const mpvTip = ref<{ text: string; theme: 'success' | 'warning' } | null>(null)

const themeOptions: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: '亮色' },
  { value: 'dark', label: '深色' },
  { value: 'auto', label: '跟随系统' }
]

/** 用字面量收窄，避免断言；取值不合法时忽略 */
function onThemeChange(value: unknown): void {
  if (value === 'light' || value === 'dark' || value === 'auto') setThemeMode(value)
}

/** 选 mpv 可执行文件；macOS 上要选到 `mpv.app/Contents/MacOS/mpv` 这一层（机器可读的自动探测仍会兜底） */
async function onChooseMpv(): Promise<void> {
  const result = await dialogApi.open({ title: '选择 mpv 可执行文件' })
  const picked = result.filePaths[0]
  if (result.canceled || !picked) return
  setting.value.mpvPath = picked
  mpvTip.value = null
}

/** 按当前填的路径（留空则自动探测）验证 mpv 能不能用 */
async function onProbeMpv(): Promise<void> {
  probing.value = true
  try {
    const result = await playerApi.detect(setting.value.mpvPath)
    mpvTip.value = result.found
      ? {
          text: `已找到 mpv：${result.path}${result.version ? `（${result.version}）` : ''}`,
          theme: 'success'
        }
      : { text: '没找到 mpv，播放窗口会用内置播放器', theme: 'warning' }
  } finally {
    probing.value = false
  }
}
</script>
