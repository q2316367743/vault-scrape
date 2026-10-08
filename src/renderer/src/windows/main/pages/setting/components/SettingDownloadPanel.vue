<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useSettingDownloadStore } from '@/windows/main/store'
import { badgeCornerOptions, nfoFileNamingOptions } from '../settingOptions'

const { setting } = storeToRefs(useSettingDownloadStore())
</script>

<template>
  <t-list class="setting-list" split size="small">
    <t-list-item>
      <t-list-item-meta title="下载横版缩略图" description="thumb" />
      <template #action>
        <div class="setting-field"><t-switch v-model="setting.downloadThumb" /></div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="下载海报" description="poster" />
      <template #action>
        <div class="setting-field"><t-switch v-model="setting.downloadPoster" /></div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="为封面添加标签角标" description="按影片标签自动添加角标，仅处理本次新下载的海报" />
      <template #action>
        <div class="setting-field"><t-switch v-model="setting.posterTagBadge" /></div>
      </template>
    </t-list-item>

    <t-list-item v-if="setting.posterTagBadge">
      <t-list-item-meta title="角标启用类型" description="输入标签后回车添加，支持多个" />
      <template #action>
        <div class="setting-field">
          <t-select
            v-model="setting.posterBadgeTypes"
            multiple
            filterable
            creatable
            placeholder="输入标签后回车"
          />
        </div>
      </template>
    </t-list-item>

    <t-list-item v-if="setting.posterTagBadge">
      <t-list-item-meta title="角标位置" description="角标在海报上的位置" />
      <template #action>
        <div class="setting-field">
          <t-select v-model="setting.posterBadgeCorner" :options="badgeCornerOptions" />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="下载背景图" description="fanart" />
      <template #action>
        <div class="setting-field"><t-switch v-model="setting.downloadFanart" /></div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="下载剧照" description="still" />
      <template #action>
        <div class="setting-field"><t-switch v-model="setting.downloadStill" /></div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="下载预告片" description="trailer" />
      <template #action>
        <div class="setting-field"><t-switch v-model="setting.downloadTrailer" /></div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="保留已有横版缩略图" description="本地已存在时不覆盖" />
      <template #action>
        <div class="setting-field"><t-switch v-model="setting.keepThumb" /></div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="保留已有海报" description="本地已存在时不覆盖" />
      <template #action>
        <div class="setting-field"><t-switch v-model="setting.keepPoster" /></div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="保留已有背景图" description="本地已存在时不覆盖" />
      <template #action>
        <div class="setting-field"><t-switch v-model="setting.keepFanart" /></div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="保留已有剧照" description="本地已存在时不覆盖" />
      <template #action>
        <div class="setting-field"><t-switch v-model="setting.keepStill" /></div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="保留已有预告片" description="本地已存在时不覆盖" />
      <template #action>
        <div class="setting-field"><t-switch v-model="setting.keepTrailer" /></div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="生成 NFO" description="刮削时生成影片信息文件" />
      <template #action>
        <div class="setting-field"><t-switch v-model="setting.generateNfo" /></div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="NFO 文件命名" description="决定 NFO 的文件名" />
      <template #action>
        <div class="setting-field">
          <t-select v-model="setting.nfoFileNaming" :options="nfoFileNamingOptions" />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="保留已有 NFO" description="本地已存在时不覆盖" />
      <template #action>
        <div class="setting-field"><t-switch v-model="setting.keepNfo" /></div>
      </template>
    </t-list-item>
  </t-list>
</template>
