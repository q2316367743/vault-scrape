/**
 * 播放会话（渲染层）：把「主进程推来的状态」与「内置播放器自己算出来的状态」折成同一份 `PlayerState`。
 *
 * 契约：
 * - 主进程是权威：`load()` 给出「用哪个后端 + 播什么地址」，mpv 后端的状态一律从 `player:state` 来；
 * - 内置播放器（后端 `html5`）反过来：状态由 artplayer 的事件折算，主进程不再推状态，
 *   只有「播放中途 mpv 自己退了」那一次例外 —— 主进程会推一份带 `error` 的 html5 快照，
 *   渲染层据此切到 artplayer 并从 `position` 续播，同时把 `error` 原样提示；
 * - 命令按当前后缘分发：mpv 走 IPC，html5 直接调 artplayer；`fullscreen` 两个后端都交给主进程
 *   （嵌入模式下 mpv 管不了父窗口，全屏只能是窗口层的事）；
 * - 排法（全屏 / 控制条占不占一行 / 视频区要不要透明）由主进程算，`player:layout` 推来；
 *   主进程在「后端变化、页面加载完、进出全屏」时都会补推一次；
 * - 地址变化一律销毁重建 artplayer，避免上一部影片的缓冲与错误残留。
 */
import { computed, ref, type Ref } from 'vue'
import Artplayer from 'artplayer'
import type { PlayerCommand, PlayerLoadResult, PlayerState } from '@common/types/player'
import { buildPlayerState } from '@common/types/player'
import type { PlayerLayoutState } from '@common/types/player/layout'
import { playerApi } from '@/api'
import { artplayerI18n } from '@/components/media/mediaPlayerI18n'

export interface PlaySession {
  /** 当前播放状态（两个后端同一个形状） */
  state: Ref<PlayerState>
  /** 这次装载用的是哪个后端、播的什么地址、装的是哪个条目 */
  result: Ref<PlayerLoadResult | null>
  /** 主进程推来的排法：全屏 / 控制条占不占一行 / 视频区要不要透明 */
  layout: Ref<PlayerLayoutState>
  /** 窗口是不是全屏（全屏时收起标题栏、侧栏与控制条） */
  fullscreen: Ref<boolean>
  /** 非空时向用户提示这句话：mpv 起不来 / 播放中途退出 */
  notice: Ref<string>
  /** 视频区元素由 `PlayStage` 交进来，artplayer 挂在这上面 */
  attachStage: (el: HTMLDivElement | null) => void
  /** 订阅 + 装载待播目标；`PlayApp` 挂载后调用一次 */
  start: () => Promise<void>
  /** 发一条命令；渲染层不自己维护播放意图 */
  apply: (command: PlayerCommand) => Promise<void>
  /** 关页面时收摊：退订 + 销毁 artplayer */
  dispose: () => void
}

export function usePlaySession(): PlaySession {
  const state = ref<PlayerState>(buildPlayerState())
  const result = ref<PlayerLoadResult | null>(null)
  // 主进程还没推之前按「独占一行 + 纯黑」算（改动前的行为），避免第一帧就摆错
  const layout = ref<PlayerLayoutState>({ fullscreen: false, controlBarRow: true, transparentStage: false })
  const fullscreen = computed(() => layout.value.fullscreen)
  const notice = ref('')

  let stage: HTMLDivElement | null = null
  let art: Artplayer | null = null
  let unsubscribe: (() => void)[] = []

  /** 主题色跟随 tdesign 品牌色；读不到时回落到 tdesign 默认蓝 */
  function themeColor(): string {
    const value = getComputedStyle(document.documentElement).getPropertyValue('--td-brand-color')
    return value.trim() || '#0052d9'
  }

  function sync(patch: Partial<PlayerState>): void {
    state.value = { ...state.value, ...patch }
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
    // 构造项里 `playbackRate` 是「开不开这个设置项」，倍速本身在构造后设到 video 上
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
    })
    player.on('video:loadedmetadata', () => sync({ duration: player.duration || 0 }))
    player.on('video:timeupdate', () => sync({ position: player.currentTime || 0 }))
    player.on('video:play', () => sync({ paused: false, ended: false }))
    player.on('video:pause', () => sync({ paused: true }))
    player.on('video:waiting', () => sync({ buffering: true }))
    player.on('video:playing', () => sync({ buffering: false }))
    player.on('video:volumechange', () => sync({ volume: player.volume, muted: player.muted }))
    player.on('video:ratechange', () => sync({ rate: player.playbackRate }))
    player.on('video:ended', () => sync({ ended: true, paused: true, buffering: false }))
    player.on('video:error', () =>
      sync({ ready: false, error: '内置播放器放不了这个视频：文件可能已被移动或删除，也可能是视频格式不受支持。' })
    )
  }

  /** 装载结果落地：mpv 只等主进程推状态，html5 立刻自己起播 */
  function applyResult(next: PlayerLoadResult): void {
    result.value = next
    if (next.reason.length > 0) notice.value = next.reason
    const keep = { volume: state.value.volume, muted: state.value.muted, rate: state.value.rate }
    if (next.backend === 'html5' && next.url.length > 0) {
      state.value = { ...buildPlayerState('html5'), ...keep }
      createArt(next.url, 0)
      return
    }
    destroyArt()
    if (next.url.length === 0) {
      notice.value = '这个条目还没有可播放的媒体源，请先对资料库重新扫描。'
      state.value = { ...buildPlayerState('html5'), ...keep }
      return
    }
    state.value = { ...buildPlayerState('mpv'), ...keep }
  }

  /** 主进程推来的状态：mpv 全收；html5 只认「mpv 中途退出」那一次降级 */
  function onMainState(next: PlayerState): void {
    if (next.backend === 'mpv') {
      state.value = next
      return
    }
    if (next.error.length === 0) return
    notice.value = next.error
    state.value = { ...next }
    const url = result.value?.url ?? ''
    if (url.length > 0 && !art) createArt(url, next.position)
  }

  async function start(): Promise<void> {
    unsubscribe = [
      playerApi.onState(onMainState),
      playerApi.onSwitch(applyResult),
      playerApi.onLayout((next) => {
        layout.value = next
      })
    ]
    applyResult(await playerApi.load())
  }

  async function apply(command: PlayerCommand): Promise<void> {
    // 全屏永远是窗口层的事，两个后端都走主进程
    if (command.kind === 'fullscreen' || state.value.backend === 'mpv' || !art) {
      await playerApi.command(command)
      return
    }
    const player = art
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
  }

  function dispose(): void {
    for (const off of unsubscribe) off()
    unsubscribe = []
    destroyArt()
  }

  return {
    state,
    result,
    layout,
    fullscreen,
    notice,
    attachStage: (el) => {
      const changed = stage !== el
      stage = el
      // 视频区换过元素（比如全屏切换重建了 DOM）时把画面接续上，别留黑屏
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
