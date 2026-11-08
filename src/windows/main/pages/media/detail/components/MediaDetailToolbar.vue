<template>
  <div class="detail-bar" :class="{ 'is-solid': collapsed }">
    <t-button class="bar-button" shape="circle" aria-label="返回" @click="goBack">
      <chevron-left-icon />
    </t-button>

    <span class="bar-title" :title="title" :aria-hidden="!collapsed">{{ title }}</span>

    <t-dropdown :options="options" trigger="click" placement="bottom-right" @click="onAction">
      <t-button
        class="bar-button"
        :shape="collapsed ? 'circle' : 'round'"
        :loading="busy"
        aria-label="更多"
      >
        <template #icon><more-icon /></template>
        <span v-if="!collapsed">更多</span>
      </t-button>
    </t-dropdown>
  </div>
</template>

<script setup lang="ts">
/**
 * 详情页吸顶悬浮条：压在封面图上，标题滚出视野后退成一条半透明横幅。
 *
 * 契约：
 * - 吸顶由自己负责（`position: sticky; top: 0`），父容器是滚动容器（详情页根节点 `overflow: auto`）；
 *   再用 `margin-bottom` 负掉自己的高度，所以**不占流内空间**，头部图片依旧贴到容器顶边；
 *   因此它必须是滚动容器的第一个子节点；
 * - 高度写死 56px：详情页用它做 `IntersectionObserver` 的 `rootMargin` 来判断「标题已经滚出去」，
 *   两处必须一起改（见 `composables/useDetailScroll.ts` 的 `BAR_HEIGHT`）；
 * - `pointer-events: none`——中间空档要放行给头部的「点击查看原图」，只有两枚按钮自己收点击；
 * - 返回语义与 `SubPageLayout` 一致，是 `router.back()`（历史为空时兜底 `/media`），页面不要再放返回按钮；
 * - `collapsed` 为真（标题滚出去了）时：整条落半透明底色 + 毛玻璃、标题淡入（单行省略号，靠 `title` 看全）、
 *   「更多」从「图标 + 文字」的药丸收成一枚圆形图标按钮，与返回同形，把宽度让给标题；
 * - 「更多」里是「重新读取」「还原刮削前」，详情已读到时最上面还有「手动匹配」与「翻译」：前两者始终可用
 *   （详情没读出来时「重新读取」就是重试入口），「手动匹配」「翻译」「还原刮削前」只在详情读出来（`loaded`）后出现；
 *   「翻译」**不受设置里的翻译开关影响**，永远在这里：插件齐不齐、有没有启用由页面在点开时告诉用户；
 * - `busy`（读取中 / 还原中）时「更多」自己转圈、菜单项全部禁用，避免连点；动作只 `emit`，取数与还原都留给页面；
 * - 「还原刮削前」是危险操作，菜单项用 `theme: 'error'` 标红；二次确认与后果说明在页面的确认框里。
 */
import { computed, h } from 'vue'
import {
  ChevronLeftIcon,
  MoreIcon,
  RefreshIcon,
  RollbackIcon,
  SearchIcon,
  TranslateIcon
} from 'tdesign-icons-vue-next'
import type { DropdownOption } from 'tdesign-vue-next'
import { useSafeBack } from '@/composables'

const props = defineProps<{
  /** 详情是否已读到：没读到时不显示「还原刮削前」 */
  loaded: boolean
  /** 重新读取中 / 还原中 */
  busy: boolean
  /** 头部标题是否已经滚出视野：真时显形为半透明横幅 */
  collapsed: boolean
  /** 横幅里的标题（单行省略号） */
  title: string
}>()

const emit = defineEmits<{ reload: []; restore: []; match: []; translate: [] }>()

const goBack = useSafeBack('/media')

const options = computed<DropdownOption[]>(() => {
  const items: DropdownOption[] = []
  if (props.loaded) {
    items.push({
      content: '手动匹配',
      value: 'match',
      prefixIcon: () => h(SearchIcon),
      disabled: props.busy
    })
    items.push({
      content: '翻译',
      value: 'translate',
      prefixIcon: () => h(TranslateIcon),
      disabled: props.busy
    })
  }
  items.push({
    content: '重新读取',
    value: 'reload',
    prefixIcon: () => h(RefreshIcon),
    disabled: props.busy
  })
  if (props.loaded) {
    items.push({
      content: '还原刮削前',
      value: 'restore',
      prefixIcon: () => h(RollbackIcon),
      theme: 'error',
      disabled: props.busy
    })
  }
  return items
})

/** 菜单项的 value 只在本组件定义，页面不感知 */
function onAction(option: DropdownOption): void {
  if (option.value === 'reload') emit('reload')
  if (option.value === 'restore') emit('restore')
  if (option.value === 'match') emit('match')
  if (option.value === 'translate') emit('translate')
}
</script>

<style scoped lang="less">
/*
 * 顶边一条浮层，高度 56px（页面按它算 rootMargin，改这里要同步改页面的 BAR_HEIGHT）。
 * 只让两枚按钮收点击：中间空档若也吃事件，头部那层「点击查看原图」（`.hero-mask`，z-index 2）就点不到了。
 */
.detail-bar {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 56px;
  margin-bottom: -56px;
  padding: 0 16px;
  pointer-events: none;
}

/*
 * 横幅底色走伪元素 + opacity（不用 color-mix，兼容面更宽）：`.is-solid` 才显形，
 * 滚动中淡入。内容都 `position: relative`，压在它上面。
 */
.detail-bar::before {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--td-bg-color-container);
  border-bottom: 1px solid transparent;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.detail-bar.is-solid {
  backdrop-filter: blur(12px);
}

.detail-bar.is-solid::before {
  border-bottom-color: var(--td-component-stroke);
  opacity: 0.82;
}

/*
 * 两枚都是文字按钮（`variant="text"`）：不铺面板底色，压在图上更轻。
 * 没落底（还没滚出去）时封面图就在身后，用反色字才看得清；落到横幅底色上再换回常规文字色。
 */
.bar-button {
  position: relative;
  flex-shrink: 0;
  pointer-events: auto;
}

.detail-bar:not(.is-solid) .bar-button {
  color: var(--td-text-color-anti);
}

.bar-title {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  color: var(--td-text-color-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.detail-bar.is-solid .bar-title {
  opacity: 1;
}
</style>
