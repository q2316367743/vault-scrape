<script setup lang="ts">
/**
 * 影片图片的统一出口：列表页 / 搜索页 / 详情页渲染敏感图片时必须用它。
 *
 * 契约：
 * - `protect` 由调用方按「全局 NSFW 开关 + 存储 nsfw 标记」判定后传入
 *   （带存储上下文用 `useNsfwProtection(connection)` 的 `active`，
 *   不带存储上下文用它的 `protection`），组件本身不读设置、不读连接；
 * - 保护生效时先显示遮罩，用户点击后本组件实例内放行，刷新页面重新隐藏；
 * - 图片地址为空时不渲染任何占位，交由调用方的空态处理。
 */
import { computed, ref } from 'vue'
import { ViewModuleIcon } from 'tdesign-icons-vue-next'

const props = withDefaults(
  defineProps<{
    /** 图片地址 */
    src: string
    /** 是否处于 NSFW 保护中 */
    protect?: boolean
    alt?: string
    /** 数字按 px 处理，0 表示撑满父容器 */
    width?: number | string
    height?: number | string
    fit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down'
  }>(),
  { protect: false, alt: '', width: 0, height: 0, fit: 'cover' }
)

const revealed = ref(false)
const concealed = computed(() => props.protect && !revealed.value)

function sizeOf(value: number | string): string {
  if (typeof value === 'string') return value
  return value > 0 ? `${value}px` : '100%'
}

const boxStyle = computed(() => ({ width: sizeOf(props.width), height: sizeOf(props.height) }))
</script>

<template>
  <div class="sensitive-image" :style="boxStyle">
    <t-image v-if="!concealed" class="sensitive-image-media" :src="src" :alt="alt" :fit="fit" />
    <div v-else class="sensitive-image-mask">
      <t-button variant="text" theme="default" @click="revealed = true">
        <template #icon><view-module-icon /></template>
        内容已隐藏，点击查看
      </t-button>
    </div>
  </div>
</template>

<style scoped lang="less">
.sensitive-image {
  position: relative;
  overflow: hidden;
  border-radius: var(--td-radius-default);
  background-color: var(--td-bg-color-container-hover);
}

.sensitive-image-media {
  display: block;
  width: 100%;
  height: 100%;

  :deep(img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.sensitive-image-mask {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 4px;
  text-align: center;
}
</style>
