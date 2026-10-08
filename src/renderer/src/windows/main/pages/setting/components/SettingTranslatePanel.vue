<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useSettingTranslateStore } from '@/windows/main/store'
import { translateLanguageOptions } from '../settingOptions'

const { setting } = storeToRefs(useSettingTranslateStore())
</script>

<template>
  <t-list class="setting-list" split size="small">
    <t-list-item>
      <t-list-item-meta title="是否启用翻译" description="开启后刮削结果按目标语言翻译" />
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
  </t-list>
</template>
