/**
 * 播放窗口：按需创建、换片、聚焦与关闭。
 *
 * 契约（与 Electron 版本的区别）：
 * - 窗口由 core 通过宿主 API 动态创建（`ctx.window.create` + `ctx.webview.createWebview`），
 *   页面是包内的 `ui/play.html`；
 * - 窗口先以隐藏状态建好，等播放页挂载后调 `playerLoad`，拿到待播目标再显示，避免白屏闪烁；
 * - 同一时刻只允许一个播放窗口；已存在时换片走 `player:switch` 事件；
 * - 窗口关闭由宿主的 `onWindowClosed` 钩子通知，这里负责收摊并广播状态。
 */
import type { PlayerLoadResult, PlayerOpenPayload, PlayerStatus } from '@common/types/player'
import { CORE_EVENTS } from '@common/channels'
import { host } from '../../runtime/host'
import { broadcastPlayerStatus } from './playerEvents'
import {
  currentState,
  currentTarget,
  loadTarget,
  stopSession
} from './playerSession'

const PLAY_WINDOW = 'play'
const PLAY_PAGE = 'ui/play.html'

let playOpen = false
/** 播放页是否已经挂载并取过目标（页面没挂载前换片只改 pending） */
let playReady = false
let pending: PlayerOpenPayload | null = null
let creating: Promise<void> | null = null

/** 没有可用目标时的统一回落：空地址 + 内置播放器 */
const EMPTY_RESULT: PlayerLoadResult = {
  backend: 'html5',
  url: '',
  reason: '',
  itemId: '',
  episodeId: ''
}

export function currentPlayerOpen(): boolean {
  return playOpen
}

/** 打开播放窗口；已有窗口就换片并聚焦 */
export async function openPlayerWindow(payload: PlayerOpenPayload): Promise<void> {
  if (!playOpen) {
    pending = payload
    await createPlayWindow()
    return
  }
  if (!playReady) {
    pending = payload
    return
  }
  await host().window.unminimize(PLAY_WINDOW)
  await host().window.show(PLAY_WINDOW)
  await host().window.setFocus(PLAY_WINDOW)
  const result = await loadTarget(payload)
  host().event.emitTo(PLAY_WINDOW, CORE_EVENTS.playerSwitch, result)
  broadcastPlayerStatus(playerStatus())
}

/** 播放窗口挂载后调用：返回待播目标并显示窗口 */
export async function takePlayerTarget(): Promise<PlayerLoadResult> {
  playReady = true
  const target = pending
  pending = null
  await host().window.unminimize(PLAY_WINDOW)
  await host().window.show(PLAY_WINDOW)
  await host().window.setFocus(PLAY_WINDOW)
  const result = target ? await loadTarget(target) : EMPTY_RESULT
  broadcastPlayerStatus(playerStatus())
  return result
}

/** 播放窗口关闭（用户点关闭 / 宿主销毁）后的收摊 */
export function handlePlayerWindowClosed(): void {
  playOpen = false
  playReady = false
  pending = null
  stopSession()
  broadcastPlayerStatus(playerStatus())
}

export async function closePlayerWindow(): Promise<void> {
  if (!playOpen) return
  await host().window.close(PLAY_WINDOW)
}

/** 聚焦播放窗口：主窗口标题栏点「正在播放」标签时调 */
export async function focusPlayerWindow(): Promise<void> {
  if (!playOpen) return
  await host().window.unminimize(PLAY_WINDOW)
  await host().window.show(PLAY_WINDOW)
  await host().window.setFocus(PLAY_WINDOW)
}

/** 当前播放状态快照：主窗口标题栏的「正在播放」标签用 */
export function playerStatus(): PlayerStatus {
  const target = currentTarget()
  return {
    open: playOpen,
    itemId: target?.itemId ?? '',
    episodeId: target?.episodeId ?? '',
    title: target?.title ?? '',
    subtitle: target?.subtitle ?? '',
    state: currentState()
  }
}

/** 建窗口 + 挂主视图；并发调用共享同一次创建 */
async function createPlayWindow(): Promise<void> {
  if (creating) return creating
  creating = (async () => {
    try {
      await host().window.create({
        label: PLAY_WINDOW,
        title: '刮削 · 播放',
        width: 1280,
        height: 800,
        minWidth: 1040,
        minHeight: 640,
        center: true,
        resizable: true,
        decorations: true,
        titleBarStyle: 'hidden',
        backgroundColor: '#000000',
        visible: false
      })
      await host().webview.createWebview({
        window: PLAY_WINDOW,
        label: PLAY_WINDOW,
        url: PLAY_PAGE,
        x: 0,
        y: 0,
        // 子视图默认 400×300；这里显式给窗口内容区尺寸，autoResize 才能等比铺满
        width: 1280,
        height: 800,
        autoResize: true
      })
      playOpen = true
      broadcastPlayerStatus(playerStatus())
    } catch (error) {
      pending = null
      playOpen = false
      const message = error instanceof Error ? error.message : '未知错误'
      host().log(`播放窗口创建失败：${message}`, 'error')
      throw error
    } finally {
      creating = null
    }
  })()
  return creating
}
