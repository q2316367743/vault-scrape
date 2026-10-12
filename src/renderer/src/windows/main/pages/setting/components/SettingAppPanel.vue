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
        description="总开关：开启后，标记为 NSFW 的存储与资料库会隐藏列表、搜索与详情页的敏感图片；关闭时一律显示"
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
      <t-list-item-meta title="使用 mpv 播放" :description="mpvSwitchDesc" />
      <template #action>
        <div class="setting-field">
          <t-tag v-if="isMac" variant="light-outline">暂不支持</t-tag>
          <t-switch v-else v-model="setting.mpvEnabled" />
        </div>
      </template>
    </t-list-item>

    <t-list-item v-if="!isMac">
      <t-list-item-meta
        title="mpv 播放器路径"
        description="仅总开关打开时生效：留空自动探测，找不到 mpv 时使用内置播放器"
      />
      <template #action>
        <div class="flex flex-col items-end gap-4px">
          <div class="flex items-center gap-8px">
            <t-input
              v-model="setting.mpvPath"
              class="w-320px"
              placeholder="留空自动探测"
              :disabled="mpvDisabled"
            />
            <t-button variant="outline" :disabled="mpvDisabled" @click="onChooseMpv">
              选择
            </t-button>
            <t-button
              variant="outline"
              :loading="probing"
              :disabled="mpvDisabled"
              @click="onProbeMpv"
            >
              检测
            </t-button>
          </div>
          <t-tag v-if="mpvTip" :theme="mpvTip.theme" variant="light" class="max-w-420px">
            {{ mpvTip.text }}
          </t-tag>
        </div>
      </template>
    </t-list-item>
  </t-list>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { setThemeMode, themeMode, type ThemeMode } from '@/global/AppTheme'
import DirectoryPickerField from '@/components/DirectoryPickerField.vue'
import { appWindowApi, dialogApi, playerApi } from '@/api'
import { useSettingAppStore } from '@/windows/main/store'

const { setting } = storeToRefs(useSettingAppStore())

/** 红黄绿灯是 macOS 独有的，mpv 的开关在这套平台上也有区别 */
const isMac = appWindowApi.isMac
/**
 * macOS 上停用 mpv：那一项只留一句结论说明，路径项整项不显示。
 *
 * 原因只写在这里，不进界面文案：mpv 的 `--wid`（嵌进已有窗口）只在 X11 / win32 / Android 有官方支持，
 * macOS 只剩「mpv 独立窗口 + 播放窗口透明挖洞」一条路，而透明窗口实测会让播放一卡一卡、窗口跟随还有可见
 * 延迟——所以 macOS 一律走内置播放器（主进程 `locateMpv()` 也会直接返回「没找到」）。界面文案只说结论。
 */
const mpvDisabled = computed(() => !setting.value.mpvEnabled)
const mpvSwitchDesc = isMac
  ? 'macOS 上暂不支持 mpv 播放，一律使用内置播放器'
  : '总开关：关闭后一律使用内置播放器，忽略下面的路径、也不自动探测'
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

/** 选 mpv 可执行文件；留空时机器可读的自动探测仍会兜底 */
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
