<script setup lang="ts">
/**
 * 详情页的「NFO 元信息」块：读到的字段 + 剧情简介；没有 NFO 时给出中文说明。
 *
 * 契约：只读详情结果，不取数；没有 NFO 是正常情况（标题按文件名推断、封面取同目录图片）。
 */
import { computed } from 'vue'
import type { MediaDetailResult } from '@common/types/media'
import { nfoCells } from '../mediaDetailCells'
import MediaFactGrid from './MediaFactGrid.vue'

const props = defineProps<{ detail: MediaDetailResult }>()

const cells = computed(() => nfoCells(props.detail))
</script>

<template>
  <section class="nfo-block">
    <h4 class="block-title">NFO 元信息</h4>

    <template v-if="detail.meta">
      <p v-if="detail.nfoPath" class="nfo-path">来源：{{ detail.nfoPath }}</p>
      <media-fact-grid :cells="cells" />
      <t-textarea
        v-if="detail.meta.plot"
        class="nfo-plot"
        :value="detail.meta.plot"
        :autosize="{ minRows: 6, maxRows: 20 }"
      ></t-textarea>
    </template>

    <t-empty
      v-else
      description="同目录没有可用的 NFO：标题按磁盘文件名推断，封面取同目录图片；重新刮削并生成 NFO 后即可补全"
    />
  </section>
</template>

<style scoped lang="less">
.nfo-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.block-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--td-text-color-primary);
}

.nfo-path {
  margin: 0;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
  word-break: break-all;
}

.nfo-plot {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--td-text-color-secondary);
  white-space: pre-wrap;
}
</style>
