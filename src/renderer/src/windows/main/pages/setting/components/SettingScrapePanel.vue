<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useSettingScrapeStore } from '@/windows/main/store'

const { setting } = storeToRefs(useSettingScrapeStore())
</script>

<template>
  <t-list class="setting-list" split size="small">
    <t-list-item>
      <t-list-item-meta
        title="扫描后自动刮削"
        description="资料库扫描完成后，自动为尚未刮削的影片排队刮削"
      />
      <template #action>
        <div class="setting-field">
          <t-switch v-model="setting.autoScrapeAfterScan" />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="并发线程数" description="同时进行的刮削任务数量" />
      <template #action>
        <div class="setting-field">
          <t-input-number
            v-model="setting.concurrency"
            :min="1"
            :max="32"
            theme="normal"
            suffix="个"
          />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="请求延迟" description="每次网络请求之间的等待时间" />
      <template #action>
        <div class="setting-field">
          <t-input-number v-model="setting.requestDelay" :min="0" :max="120" theme="normal" suffix="秒" />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="连续刮削后休息" description="连续处理多少条后暂停，0 表示不休息" />
      <template #action>
        <div class="setting-field">
          <t-input-number
            v-model="setting.restAfterCount"
            :min="0"
            :max="1000"
            theme="normal"
            suffix="条"
          />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="休息时长" description="触发休息后的暂停时间" />
      <template #action>
        <div class="setting-field">
          <t-input-number
            v-model="setting.restDuration"
            :min="0"
            :max="3600"
            theme="normal"
            suffix="秒"
          />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="剧照目录名" description="刮削结果里存放剧照的子目录名" />
      <template #action>
        <div class="setting-field">
          <t-input v-model="setting.fanartDirName" placeholder="extrafanart" clearable />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta
        title="自动抓取演员资料"
        description="影片刮削入库后，为参演演员抓取资料与图片；需要启用「演员信息插件」"
      />
      <template #action>
        <div class="setting-field">
          <t-switch v-model="setting.actorScrape" />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta
        title="打开详情页自动补全"
        description="演员资料不全时（没抓过、没头像或没生日），打开演员详情页自动抓一次"
      />
      <template #action>
        <div class="setting-field">
          <t-switch v-model="setting.actorScrapeOnOpen" />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="演员图片上限" description="单个演员最多下载多少张图片，0 表示不下载" />
      <template #action>
        <div class="setting-field">
          <t-input-number
            v-model="setting.actorImageLimit"
            :min="0"
            :max="200"
            theme="normal"
            suffix="张"
          />
        </div>
      </template>
    </t-list-item>
  </t-list>
</template>
