<template>
  <t-list class="setting-list" split size="small">
    <t-list-item v-for="type in LIBRARY_TYPES" :key="type">
      <t-list-item-meta
        :title="`${LIBRARY_TYPE_LABELS[type]}媒体后缀`"
        description="这些后缀会被识别为该类型的媒体文件，扫描资料库时生效；后缀不带点、小写"
      />
      <template #action>
        <div class="setting-field">
          <t-tag-input
            v-model="setting.extensions[type]"
            :max="LIBRARY_EXTENSION_LIMIT"
            :excess-tips="excessTips"
            clearable
            placeholder="回车添加后缀"
            @blur="onCommit(type)"
          />
        </div>
      </template>
    </t-list-item>
  </t-list>
</template>
<script setup lang="ts">
/**
 * 设置 · 资料库面板：逐类型维护媒体后缀清单。
 *
 * 契约：
 * - 存放位置是 `SettingLibrary.extensions[type]`，保存由 store 的防抖 watcher 负责，
 *   面板不显式调用保存接口；
 * - 输入允许大写、带点：失焦时用 `normalizeExtensionList` 清洗一次再写回，
 *   避免把脏值留在设置里；
 * - 数量上限 `LIBRARY_EXTENSION_LIMIT`，超出由 TagInput 拦下并提示；
 * - 清空时提示「至少要保留一个后缀」，并用 `DEFAULT_LIBRARY_EXTENSIONS` 回落。
 */
import { storeToRefs } from 'pinia'
import { MessagePlugin } from 'tdesign-vue-next'
import { LIBRARY_TYPES, LIBRARY_TYPE_LABELS, type LibraryType } from '@common/types/library'
import {
  DEFAULT_LIBRARY_EXTENSIONS,
  LIBRARY_EXTENSION_LIMIT,
  normalizeExtensionList
} from '@common/types/setting'
import { useSettingLibraryStore } from '@/windows/main/store'

const { setting } = storeToRefs(useSettingLibraryStore())

const excessTips = `最多 ${LIBRARY_EXTENSION_LIMIT} 个后缀`

/** 失焦才清洗：输入过程中不打断用户，避免刚敲一半就被改写 */
function onCommit(type: LibraryType): void {
  const fallback = DEFAULT_LIBRARY_EXTENSIONS[type]
  const raw = setting.value.extensions[type]
  if (raw.length === 0) {
    MessagePlugin.warning('至少要保留一个后缀，已回落默认值')
    setting.value.extensions[type] = [...fallback]
    return
  }
  const normalized = normalizeExtensionList(raw, fallback)
  if (raw.length > LIBRARY_EXTENSION_LIMIT) {
    MessagePlugin.warning(`最多保留 ${LIBRARY_EXTENSION_LIMIT} 个后缀，多余的已丢弃`)
  }
  if (raw.join('\n') !== normalized.join('\n')) {
    setting.value.extensions[type] = normalized
  }
}
</script>
