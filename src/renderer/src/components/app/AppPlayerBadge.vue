<template>
  <t-tooltip v-if="status.open" :content="tooltip" placement="bottom">
    <t-button shape="round" size="small" variant="outline" @click="onFocus">
      <template #icon>
        <play-icon class="badge-icon" />
      </template>
      <span class="badge-name">{{ displayName }}</span>
      <span class="badge-state">{{ stateText }}</span>
    </t-button>
  </t-tooltip>
</template>

<script setup lang="ts">
/**
 * 标题栏的「正在播放」标签（只挂在主窗口）。
 *
 * 契约：
 * - 标签的有无、片名与播放状态全部来自主进程广播的 `PlayerStatus`：播放窗口不存在就整块不渲染，
 *   关掉播放窗口标签立刻消失（窗口在不在只有主进程知道，渲染层不猜）；
 * - 点击只做一件事：让主进程聚焦播放窗口（最小化过会先还原）；
 * - 挂在 `AppTitleBar` 的 `afterTitle` 插槽里（紧挨产品名，不跟着 `trailing` 被推到最右）：标题栏整条是拖动区，
 *   而它对 `.t-button` 已统一排除拖动，所以这里必须用 tdesign 按钮，否则点击会被窗口拖动吞掉；
 * - 状态文案与图标只表达「播放器在干什么」，不参与任何播放控制 —— 控制仍归播放窗口。
 */
import { PlayIcon } from 'tdesign-icons-vue-next'
import { buildPlayerState, type PlayerState, type PlayerStatus } from '@common/types/player'
import { playerApi } from '@/api'
import { formatClock } from '@/utils/format'

/** 没有播放窗口时的初值：与主进程的空快照同形状，挂载后立刻被真实值覆盖 */
const EMPTY_STATUS: PlayerStatus = {
  open: false,
  itemId: '',
  episodeId: '',
  title: '',
  subtitle: '',
  state: buildPlayerState()
}

const status = ref<PlayerStatus>(EMPTY_STATUS)

let dispose: (() => void) | undefined

/** 片名：目标还没装载时给个占位，避免标签空着 */
const title = computed(() => (status.value.title.length > 0 ? status.value.title : '未命名条目'))
/** 剧集带上这一集的说明（`第 1 季 第 2 集`），影片为空 */
const displayName = computed(() =>
  status.value.subtitle.length > 0 ? `${title.value} · ${status.value.subtitle}` : title.value
)
const stateText = computed(() => stateTextOf(status.value.state))

const tooltip = computed(() => {
  const state = status.value.state
  const parts = [displayName.value, stateText.value]
  if (state.duration > 0) {
    parts.push(`${formatClock(state.position)} / ${formatClock(state.duration)}`)
  }
  parts.push(state.backend === 'mpv' ? 'mpv' : '内置播放器')
  if (state.error.length > 0) parts.push(state.error)
  parts.push('点击聚焦播放窗口')
  return parts.join(' · ')
})

/** 播放器状态 → 标签文案；顺序即优先级（出错 / 播完要盖过「正在播放」） */
function stateTextOf(state: PlayerState): string {
  if (state.error.length > 0) return '播放出错'
  if (state.ended) return '已播完'
  if (state.buffering) return '缓冲中'
  if (!state.ready) return '正在打开'
  if (state.paused) return '已暂停'
  return '正在播放'
}

function onFocus(): void {
  void playerApi.focus()
}

onMounted(() => {
  // 先订阅再拉快照：窗口重载（HMR）后也能拿到当前状态，不漏中间的变化
  dispose = playerApi.onStatus((value) => {
    status.value = value
  })
  void playerApi.getStatus().then((value) => {
    status.value = value
  })
})

onUnmounted(() => {
  dispose?.()
})
</script>

<style scoped lang="less"></style>
