<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useSettingNetworkStore } from '@/windows/main/store'
import { proxyTypeOptions } from '../settingOptions'

const { setting } = storeToRefs(useSettingNetworkStore())
</script>

<template>
  <t-list class="setting-list" split size="small">
    <t-list-item>
      <t-list-item-meta title="是否启用代理" description="开启后所有网络请求走下方代理" />
      <template #action>
        <div class="setting-field">
          <t-switch v-model="setting.proxyEnabled" />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="代理协议" description="代理服务器使用的协议" />
      <template #action>
        <div class="setting-field">
          <t-select
            v-model="setting.proxyType"
            :options="proxyTypeOptions"
            :disabled="!setting.proxyEnabled"
          />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="代理地址" description="形如 127.0.0.1:7890" />
      <template #action>
        <div class="setting-field">
          <t-input
            v-model="setting.proxyHost"
            placeholder="127.0.0.1:7890"
            :disabled="!setting.proxyEnabled"
            allow-clear
          />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="超时时间" description="单次请求的最长等待时间" />
      <template #action>
        <div class="setting-field">
          <t-input-number v-model="setting.timeout" :min="1" :max="600" theme="normal" suffix="秒" />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="重试次数" description="请求失败后的自动重试次数" />
      <template #action>
        <div class="setting-field">
          <t-input-number v-model="setting.retryCount" :min="0" :max="10" theme="normal" suffix="次" />
        </div>
      </template>
    </t-list-item>
  </t-list>
</template>
