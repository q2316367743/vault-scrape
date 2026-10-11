<template>
  <section class="nfo-block">
    <h4 class="block-title">NFO 元信息</h4>

    <template v-if="detail.meta">
      <p v-if="detail.nfoPath" class="nfo-path">来源：{{ detail.nfoPath }}</p>
      <media-fact-grid :cells="cells" />
    </template>

    <t-empty
      v-else
      description="同目录没有可用的 NFO：标题按磁盘文件名推断，封面取同目录图片；重新刮削并生成 NFO 后即可补全"
    />
  </section>
</template>
<script setup lang="ts">
/**
 * 详情页的「NFO 元信息」块：只列读到的 NFO 字段；没有 NFO 时给出中文说明。
 *
 * 契约：只读详情结果，不取数；剧情简介由页面单独展示（本块不再用输入框套简介）；
 * 没有 NFO 是正常情况（标题按文件名推断、封面取同目录图片）；
 * 本块不画底板与描边：详情页是沉浸式排版，区块只靠标题与留白分隔。
 */
import { computed } from 'vue'
import type { MediaDetailResult } from '@common/types/media'
import { nfoCells } from '../mediaDetailCells'
import MediaFactGrid from './MediaFactGrid.vue'

const props = defineProps<{ detail: MediaDetailResult }>()

const cells = computed(() => nfoCells(props.detail))
</script>

<style scoped lang="less">
.nfo-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.block-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--td-text-color-primary);
}

.nfo-path {
  margin: 0;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
  word-break: break-all;
}
</style>
