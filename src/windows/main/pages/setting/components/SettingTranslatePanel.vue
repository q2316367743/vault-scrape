<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingTranslateStore } from '@/windows/main/store'
import { useTranslatePlugins } from '@/windows/main/composables/useTranslatePlugins'
import { translateLanguageOptions } from '../settingOptions'

const { setting } = storeToRefs(useSettingTranslateStore())
const { plugins, usable, load } = useTranslatePlugins()

/** 空串 = 自动选择（按插件页顺序取第一个可用的） */
const pluginOptions = computed(() => [
  { value: '', label: '自动选择' },
  ...usable.value.map((plugin) => ({ value: plugin.id, label: plugin.name }))
])

/**
 * 设置里选中但当前不可用的插件：补进候选。
 * 否则它在界面上消失，用户一保存就被静默改回「自动选择」。
 */
const selectOptions = computed(() => {
  const id = setting.value.pluginId
  if (id.length === 0 || pluginOptions.value.some((item) => item.value === id)) {
    return pluginOptions.value
  }
  const found = plugins.value.find((plugin) => plugin.id === id)
  return [...pluginOptions.value, { value: id, label: `${found ? found.name : id}（已失效）` }]
})

onMounted(() => {
  void load()
})
</script>

<template>
  <t-list class="setting-list" split size="small">
    <t-list-item>
      <t-list-item-meta title="是否启用翻译" description="开启后，刮削完成后按目标语言自动翻译" />
      <template #action>
        <div class="setting-field">
          <t-switch v-model="setting.enabled" />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="目标语言" description="翻译结果使用的语言" />
      <template #action>
        <div class="setting-field">
          <t-select
            v-model="setting.targetLanguage"
            :options="translateLanguageOptions"
            :disabled="!setting.enabled"
          />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta
        title="翻译插件"
        description="自动翻译使用的插件；选「自动选择」时按插件页顺序取第一个可用的"
      />
      <template #action>
        <div class="setting-field">
          <t-select
            v-model="setting.pluginId"
            :options="selectOptions"
            :disabled="!setting.enabled"
          />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta
        title="写入 NFO"
        description="把译文写进本地 NFO 文件，外部播放器与媒体服务器据此显示译文"
      />
      <template #action>
        <div class="setting-field">
          <t-switch v-model="setting.writeNfo" :disabled="!setting.enabled" />
        </div>
      </template>
    </t-list-item>
  </t-list>
</template>
