<template>
  <section class="play-bar">
    <div class="play-bar-text">
      <h4 class="section-title">播放</h4>
      <p v-if="hint.length > 0" class="play-bar-hint">{{ hint }}</p>
    </div>
    <t-button theme="primary" size="large" :disabled="disabled" @click="emit('play')">
      <template #icon>
        <play-circle-icon />
      </template>
      播放
    </t-button>
  </section>
</template>
<script setup lang="ts">
/**
 * 详情页的播放入口。
 *
 * 契约：
 * - 详情页不再内嵌播放器：点「播放」由页面调 `playerApi.open()` 打开独立播放窗口
 *   （左侧 mpv / 内置播放器画面，右侧影片详情侧栏）；
 * - `hint` 由页面给：只在没有可播地址时给一句原因（解释按钮为什么置灰），空串时这一行不渲染；
 *   有可播地址时不再预告「会开新窗口」之类的界面形状，播哪一集由选集区高亮表达；
 * - 没有可播地址时按钮置灰，但仍显示 `hint` 说明原因，不留一块空白。
 */
import { PlayCircleIcon } from 'tdesign-icons-vue-next'

withDefaults(
  defineProps<{
    /** 按钮旁的一句原因说明；空串时不渲染 */
    hint: string
    /** 没有可播地址时置灰 */
    disabled?: boolean
  }>(),
  { disabled: false }
)

const emit = defineEmits<{ play: [] }>()
</script>

<style scoped lang="less">
.play-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.play-bar-text {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.section-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--td-text-color-primary);
}

.play-bar-hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--td-text-color-secondary);
  word-break: break-word;
}
</style>
