<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useSettingNamingStore } from '@/windows/main/store'
import { assetNamingOptions, partStyleOptions } from '../settingOptions'
import TemplateHintBar from './TemplateHintBar.vue'

const { setting } = storeToRefs(useSettingNamingStore())
</script>

<template>
  <template-hint-bar />

  <t-list class="setting-list" split size="small">
    <t-list-item>
      <t-list-item-meta title="文件夹模板" description="决定刮削后文件夹的名字" />
      <template #action>
        <div class="setting-field">
          <t-input v-model="setting.folderTemplate" placeholder="{num}" />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="文件名模板" description="决定影片文件的名字" />
      <template #action>
        <div class="setting-field">
          <t-input v-model="setting.fileTemplate" placeholder="{num} {title}" />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="附属文件命名" description="海报 / 横版缩略图 / 背景图 / 预告片的文件名规则" />
      <template #action>
        <div class="setting-field">
          <t-select v-model="setting.assetNaming" :options="assetNamingOptions" />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="NFO 标题模板" description="写入 NFO 的标题" />
      <template #action>
        <div class="setting-field">
          <t-input v-model="setting.nfoTitleTemplate" placeholder="{num} {title}" />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="演员名最大数量" description="超出数量后按下方后缀截断" />
      <template #action>
        <div class="setting-field">
          <t-input-number v-model="setting.actorMaxCount" :min="1" :max="99" theme="normal" suffix="个" />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="演员名超出后缀" description="支持 {count} 占位符表示超出人数" />
      <template #action>
        <div class="setting-field">
          <t-input v-model="setting.actorOverflowSuffix" placeholder="等{count}人" />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta
        title="演员为空时使用片商或卖家"
        description="开启后 {actor} 无演员时回退到片商；可在模板中用 {actorFallbackPrefix}{actor} 标注来源"
      />
      <template #action>
        <div class="setting-field">
          <t-switch v-model="setting.actorFallbackToMaker" />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="发行日期格式" description="dayjs 格式串，如 YYYY-MM-DD" />
      <template #action>
        <div class="setting-field">
          <t-input v-model="setting.releaseDateFormat" placeholder="YYYY-MM-DD" />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="分盘样式" description="多分盘视频输出时的后缀处理方式" />
      <template #action>
        <div class="setting-field">
          <t-select v-model="setting.partStyle" :options="partStyleOptions" />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="文件夹名最大长度" description="超出部分将被截断" />
      <template #action>
        <div class="setting-field">
          <t-input-number
            v-model="setting.folderMaxLength"
            :min="1"
            :max="255"
            theme="normal"
            suffix="字符"
          />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="文件名最大长度" description="超出部分将被截断" />
      <template #action>
        <div class="setting-field">
          <t-input-number
            v-model="setting.fileNameMaxLength"
            :min="1"
            :max="255"
            theme="normal"
            suffix="字符"
          />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="中文字幕标记" description="识别到中文字幕时附加到文件名" />
      <template #action>
        <div class="setting-field">
          <t-input v-model="setting.chinaSubtitleTag" placeholder="中文字幕" />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="UMR 标记" description="识别到 UMR 时附加到文件名" />
      <template #action>
        <div class="setting-field">
          <t-input v-model="setting.umrTag" placeholder="UMR" />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="流出标记" description="识别到流出资源时附加到文件名" />
      <template #action>
        <div class="setting-field">
          <t-input v-model="setting.leakTag" placeholder="流出" />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="无码标记" description="识别到无码资源时附加到文件名" />
      <template #action>
        <div class="setting-field">
          <t-input v-model="setting.uncensoredTag" placeholder="无码" />
        </div>
      </template>
    </t-list-item>

    <t-list-item>
      <t-list-item-meta title="有码标记" description="识别到有码资源时附加到文件名" />
      <template #action>
        <div class="setting-field">
          <t-input v-model="setting.censoredTag" placeholder="有码" />
        </div>
      </template>
    </t-list-item>
  </t-list>
</template>
