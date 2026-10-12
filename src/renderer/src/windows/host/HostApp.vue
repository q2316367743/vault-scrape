<template>
  <div class="host" @click="onClick" @dblclick="onDblclick"></div>
</template>

<script setup lang="ts">
/**
 * 画面宿主页：Windows 嵌入模式下 mpv 的子窗口**不接收任何输入**（mpv 源码里对子窗口 `EnableWindow(0)`），
 * 而宿主窗口是一张盖住视频区的原生窗口，所以点击只能由这个页面接：
 *
 * - 单击：播放 / 暂停；
 * - 双击：全屏开关（不传 `enabled`，切给窗口层判断）。
 *
 * 单击必须等一个短暂的判定窗口再发：双击时浏览器会先发两次 `click` 再发 `dblclick`，
 * 直接发就会「暂停 → 播放 → 全屏」抖一下。
 */
import { onBeforeUnmount } from 'vue'
import { playerApi } from '@/api'

/** 单击判定窗口：够短不至于觉得迟钝，够长能吃掉双击的第一下 */
const CLICK_DELAY_MS = 220

let timer: ReturnType<typeof setTimeout> | null = null

function onClick(): void {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    void playerApi.command({ kind: 'toggle' })
  }, CLICK_DELAY_MS)
}

function onDblclick(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  void playerApi.command({ kind: 'fullscreen' })
}

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>

<style scoped lang="less">
/* 整张纸都是点击区；背景透明，露出来的是宿主窗口自己的黑色底 */
.host {
  width: 100%;
  height: 100%;
  cursor: default;
}
</style>
