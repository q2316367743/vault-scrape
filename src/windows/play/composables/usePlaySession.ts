/**
 * 播放会话（渲染层）：内置 artplayer 是唯一后端。
 *
 * 契约：
 * - core 只负责「播什么地址、窗口在不在」，播放控制与进度都在本窗口；
 * - 播放状态按 200ms 节流回报给 core，主窗口标题栏的「正在播放」标签据此更新；
 * - 全屏是窗口自己的事：`getCurrentWindow().setFullscreen()`；全屏时收起标题栏与侧栏；
 * - 地址变化一律销毁重建 artplayer，避免上一部影片的缓冲与错误残留。
 */
import { computed, ref, type Ref } from 'vue'
import Artplayer from 'artplayer'
import { getCurrentWindow } from '@dashou/api'
import type { PlayerCommand, PlayerLoadResult, PlayerState } from '@common/types/player'
import { buildPlayerState } from '@common/types/player'
import type { PlayerLayoutState } from '@common/types/player/layout'
import { playerApi } from '@/api'
import { artplayerI18n } from '@/components/media/mediaPlayerI18n'

export interface PlaySession {
  state: Ref<PlayerState>
  result: Ref<PlayerLoadResult | null>
  layout: Ref<PlayerLayoutState>
  fullscreen: Ref<boolean>
  /** 非空时向用户提示这句话（没有媒体源等） */
  notice: Ref<string>
  attachStage: (el: HTMLDivElement | null) => void
  start: () => Promise<void>
  apply: (command: PlayerCommand) => Promise<void>
  dispose: () => void
}

/** 状态回报节流间隔：与旧版 core 的推送节奏保持一致 */
const REPORT_INTERVAL_MS = 200

export function usePlaySession(): PlaySession {
  const state = ref<PlayerState>(buildPlayerState())
  const result = ref<PlayerLoadResult | null>(null)
  const fullscreen = ref(false)
  const notice = ref('')
  const layout = computed<PlayerLayoutState>(() => ({
    fullscreen: fullscreen.value,
    // 内置播放器的控制条独占一行（不再为 mpv 的悬浮模式让位）
    controlBarRow: true,
    transparentStage: false
  }))

  let stage: HTMLDivElement | null = null
  let art: Artplayer | null = null
  let unsubscribe: (() => void)[] = []
  let reportTimer: ReturnType<typeof setTimeout> | null = null
  let lastReportAt = 0

  /** 主题色跟随 tdesign 品牌色；读不到时回落到 tdesign 默认蓝 */
  function themeColor(): string {
    const value = getComputedStyle(document.documentElement).getPropertyValue('--td-brand-color')
    return value.trim() || '#0052d9'
  }

  function sync(patch: Partial<PlayerState>): void {
    state.value = { ...state.value, ...patch }
  }

  /** 状态变化回报给 core（节流），主窗口的「正在播放」标签靠它刷新 */
  function report(): void {
    const now = Date.now()
    const wait = lastReportAt + REPORT_INTERVAL_MS - now
    if (wait <= 0) {
      lastReportAt = now
      void playerApi.reportState({ ...state.value }).catch(() => undefined)
      return
    }
    if (reportTimer) return
    reportTimer = setTimeout(() => {
      reportTimer = null
      lastReportAt = Date.now()
      void playerApi.reportState({ ...state.value }).catch(() => undefined)
    }, wait)
  }

  function destroyArt(): void {
    art?.destroy()
    art = null
  }

  function createArt(url: string, position: number): void {
    destroyArt()
    if (!stage || url.length === 0) return
    const player = new Artplayer({
      container: stage,
      url,
      lang: 'zh-cn',
      i18n: artplayerI18n,
      theme: themeColor(),
      volume: state.value.volume,
      muted: state.value.muted,
      playbackRate: true,
      aspectRatio: false,
      screenshot: true,
      setting: true,
      // 快捷键由播放窗口统一接管（`useKeyboard`）：artplayer 自己监听会把 Esc / 空格吃掉一半
      hotkey: false,
      pip: true,
      // 全屏是窗口层的事，artplayer 的两种全屏都不开
      fullscreen: false,
      fullscreenWeb: false,
      miniProgressBar: true
    })
    art = player
    if (state.value.rate !== 1) player.playbackRate = state.value.rate
    player.on('ready', () => {
      sync({
        backend: 'html5',
        ready: true,
        error: '',
        duration: player.duration || 0,
        paused: !player.playing,
        volume: player.volume,
        muted: player.muted,
        rate: player.playbackRate
      })
      if (position > 0) player.currentTime = position
      report()
    })
    player.on('video:loadedmetadata', () => sync({ duration: player.duration || 0 }))
    player.on('video:timeupdate', () => {
      sync({ position: player.currentTime || 0 })
      report()
    })
    player.on('video:play', () => sync({ paused: false, ended: false }))
    player.on('video:pause', () => sync({ paused: true }))
    player.on('video:waiting', () => sync({ buffering: true }))
    player.on('video:playing', () => sync({ buffering: false }))
    player.on('video:volumechange', () => sync({ volume: player.volume, muted: player.muted }))
    player.on('video:ratechange', () => sync({ rate: player.playbackRate }))
    player.on('video:ended', () => sync({ ended: true, paused: true, buffering: false }))
    player.on('video:error', () => {
      sync({
        ready: false,
        error: '内置播放器放不了这个视频：文件可能已被移动或删除，也可能是视频格式不受支持。'
      })
      report()
    })
  }

  /** 装载结果落地：一律用内置播放器 */
  function applyResult(next: PlayerLoadResult): void {
    result.value = next
    notice.value = ''
    if (next.reason.length > 0) notice.value = next.reason
    const keep = { volume: state.value.volume, muted: state.value.muted, rate: state.value.rate }
    if (next.url.length === 0) {
      destroyArt()
      notice.value = '这个条目还没有可播放的媒体源，请先对资料库重新扫描。'
      state.value = { ...buildPlayerState('html5'), ...keep }
      report()
      return
    }
    state.value = { ...buildPlayerState('html5'), ...keep }
    createArt(next.url, 0)
  }

  async function start(): Promise<void> {
    unsubscribe = [playerApi.onSwitch(applyResult)]
    const win = getCurrentWindow()
    // 系统（Esc / 窗口按钮）改了全屏时回查一次，保证侧栏收起状态跟着变
    void win.onResized(() => {
      void win.isFullscreen().then((value) => {
        fullscreen.value = value
      })
    }).then((off) => {
      unsubscribe.push(off)
    })
    applyResult(await playerApi.load())
  }

  async function apply(command: PlayerCommand): Promise<void> {
    // 全屏是窗口自己的事：不经过 core，直接改窗口状态
    if (command.kind === 'fullscreen') {
      const next = command.enabled === undefined ? !fullscreen.value : command.enabled
      fullscreen.value = next
      await getCurrentWindow().setFullscreen(next)
      return
    }
    const player = art
    if (!player) return
    switch (command.kind) {
      case 'toggle':
        if (player.playing) player.pause()
        else void player.play()
        break
      case 'seek':
        player.currentTime = Math.max(0, command.position)
        break
      case 'seekBy':
        player.currentTime = Math.max(0, player.currentTime + command.delta)
        break
      case 'volume':
        player.volume = Math.min(1, Math.max(0, command.volume))
        break
      case 'mute':
        player.muted = command.muted
        break
      case 'rate':
        player.playbackRate = Math.min(4, Math.max(0.25, command.rate))
        break
    }
    report()
  }

  function dispose(): void {
    for (const off of unsubscribe) off()
    unsubscribe = []
    if (reportTimer) {
      clearTimeout(reportTimer)
      reportTimer = null
    }
    destroyArt()
  }

  // 全屏状态由窗口尺寸事件回查（见 start），这里不需要额外 watch

  return {
    state,
    result,
    layout,
    fullscreen,
    notice,
    attachStage: (el) => {
      const changed = stage !== el
      stage = el
      if (changed && el && art) {
        const url = result.value?.url ?? ''
        createArt(url, state.value.position)
      }
    },
    start,
    apply,
    dispose
  }
}
