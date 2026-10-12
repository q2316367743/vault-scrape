/**
 * 播放窗口：自绘标题栏 + 左侧画面 + 右侧详情侧栏的独立窗口。
 *
 * 契约（两平台策略不同，这里是差异的唯一集中点）：
 * - **Windows**：另开一个「宿主窗口」（构造项 `parent: playWin`，不用有 SIGSEGV 报告的
 *   `setParentWindow()`），尺寸永远等于视频区，mpv 用 `--wid=<宿主窗口句柄>` 嵌进去。
 *   宿主窗口的 bounds 在每次 move/resize 时同步（不防抖，否则拖动会肉眼可见地脱节）；
 * - **macOS**：默认是「mpv 无边框独立窗口 + 我们的窗口挖一个透明洞」，洞的位置靠
 *   `--geometry` 同步（`set_property geometry` 不支持时由会话层重启 mpv 兜底，所以同步走 80ms 防抖）；
 *   设置项 `app.macEmbed` 打开时改用 Windows 那套嵌入方案（实验）；
 * - 嵌入模式下 mpv 的子窗口不接收输入（mpv 源码里对子窗口 `EnableWindow(0)`），
 *   所以宿主页 `host.html` 负责接点击（单击播放/暂停、双击全屏）；
 * - 全屏时侧栏与控制条收起（`player:layout` 告诉渲染层），视频区随之扩到整块内容区。
 *
 * 对外还提供两件事给主窗口标题栏的「正在播放」标签：`playerStatus()`（窗口在不在 + 在播什么）
 * 与 `focusPlayerWindow()`（点标签时把播放窗口拉到前面）；快照由本模块广播（见 playerEvents）。
 */
import { join } from 'path'
import { BrowserWindow, screen, type BrowserWindowConstructorOptions } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { PlayerOpenPayload, PlayerState, PlayerStatus } from '@common/types/player'
import { PLAY_LAYOUT, playerStageRect, type PlayerLayoutState } from '@common/types/player/layout'
import { loadSetting } from '$/modules/setting/settingStore'
import { broadcastPlayerStatus } from '$/modules/player/playerEvents'
import {
  currentState,
  currentTarget,
  loadTarget,
  setMpvActiveSink,
  setMpvCanvasProvider,
  setStateSink,
  stopSession,
  syncCanvas as syncSessionCanvas,
  type MpvCanvas
} from '$/modules/player/playerSession'
import { debounce } from '$/utils/timing'
import { PlayerChannels } from '~/modules/player/playerChannels'

const isMac = process.platform === 'darwin'

let playWin: BrowserWindow | null = null
let hostWin: BrowserWindow | null = null
let hostWid = ''
let pending: PlayerOpenPayload | null = null
/** 宿主窗口是不是已经能显示了（`ready-to-show`） */
let hostReady = false
/** mpv 是不是正在占着画面；与 `hostReady` 一起决定宿主窗口的显隐 */
let mpvActive = false

/** macOS 挖洞方案改几何要重启 mpv，代价高：窗口拖动/缩放期间只认最后一次 */
const syncCanvasSoon = debounce(() => {
  void syncSessionCanvas()
}, 80)

/** 打开播放窗口；已经有窗口就换片并聚焦 */
export async function openPlayerWindow(payload: PlayerOpenPayload): Promise<void> {
  const existing = alive(playWin)
  if (!existing) {
    // 新窗口：目标留给渲染层挂载后自己来取（player:load）
    pending = payload
    createPlayWindow()
    return
  }
  existing.show()
  existing.focus()
  const result = await loadTarget(payload)
  const win = alive(playWin)
  if (win) win.webContents.send(PlayerChannels.switch, result)
  // 换片后目标变了，标题栏的「正在播放」跟着更新（没有媒体源时不会推状态，所以在这里兜一次）
  broadcastPlayerStatus(playerStatus())
}

/** 播放窗口挂载后拉取待播目标；没有待播目标返回 null */
export function takePlayerTarget(): PlayerOpenPayload | null {
  const target = pending
  pending = null
  return target
}

export function closePlayerWindow(): void {
  const win = alive(playWin)
  if (win) win.close()
}

/** 聚焦播放窗口：主窗口标题栏点「正在播放」标签时调（最小化过就先还原） */
export function focusPlayerWindow(): void {
  const win = alive(playWin)
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** 当前播放状态快照：主窗口标题栏的「正在播放」标签用 */
export function playerStatus(): PlayerStatus {
  return statusOf(currentState())
}

/** 组装快照：窗口在不在 + 在播什么 + 播放器状态 */
function statusOf(state: PlayerState): PlayerStatus {
  const target = currentTarget()
  return {
    open: alive(playWin) !== null,
    itemId: target?.itemId ?? '',
    episodeId: target?.episodeId ?? '',
    title: target?.title ?? '',
    subtitle: target?.subtitle ?? '',
    state
  }
}

/** 全屏开关：不传 `enabled` 就是切换 */
export function togglePlayerFullscreen(enabled?: boolean): void {
  const win = alive(playWin)
  if (!win) return
  const next = enabled ?? !isFullscreen(win)
  if (isMac) win.setSimpleFullScreen(next)
  else win.setFullScreen(next)
  // macOS 的 simple fullscreen 不发 enter/leave-full-screen，这里主动通知渲染层
  notifyLayout(next)
  notifyGeometry()
}

function createPlayWindow(): void {
  const win = new BrowserWindow(playWindowOptions())
  playWin = win
  setStateSink((state) => {
    const target = alive(playWin)
    if (target) target.webContents.send(PlayerChannels.state, state)
    // 主窗口标题栏的「正在播放」跟着一起走（播放中就是这 200ms 一次的节流推送）
    broadcastPlayerStatus(statusOf(state))
  })
  setMpvCanvasProvider(canvasOf)
  setMpvActiveSink((active) => {
    mpvActive = active
    applyHostVisibility()
  })

  const onMetricsChanged = (): void => notifyGeometry()
  screen.on('display-metrics-changed', onMetricsChanged)
  const onShown = (): void => {
    notifyGeometry()
    applyHostVisibility()
  }
  const onGeometry = (): void => notifyGeometry()
  win.on('move', onGeometry)
  win.on('resize', onGeometry)
  win.on('maximize', onGeometry)
  win.on('unmaximize', onGeometry)
  win.on('show', onShown)
  win.on('restore', onShown)
  const hideHost = (): void => hostWin?.hide()
  win.on('hide', hideHost)
  win.on('minimize', hideHost)
  win.on('close', hideHost)
  win.on('enter-full-screen', () => notifyLayout(true))
  win.on('leave-full-screen', () => notifyLayout(false))

  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.on('closed', () => {
    playWin = null
    screen.off('display-metrics-changed', onMetricsChanged)
    setStateSink(null)
    setMpvCanvasProvider(null)
    setMpvActiveSink(null)
    destroyHostWindow()
    void stopSession()
    // 窗口没了：标题栏的标签随之消失（stopSession 里已同步清掉当前目标）
    broadcastPlayerStatus(playerStatus())
  })

  loadPage(win, 'play.html')
  // 窗口一建出来就先告诉标题栏「有了」：此时目标还没装载，标签显示「正在打开」
  broadcastPlayerStatus(playerStatus())
}

function playWindowOptions(): BrowserWindowConstructorOptions {
  const base: BrowserWindowConstructorOptions = {
    width: PLAY_LAYOUT.defaultWidth,
    height: PLAY_LAYOUT.defaultHeight,
    minWidth: PLAY_LAYOUT.minWidth,
    minHeight: PLAY_LAYOUT.minHeight,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  }
  if (!isMac) return { ...base, backgroundColor: '#000000' }
  return {
    ...base,
    // 透明是为了给「mpv 独立窗口」挖洞；红黄绿灯保留系统绘制，位置与主窗口一致
    transparent: true,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 14 }
  }
}

/** 宿主窗口：只负责给 mpv 当父窗口 + 接点击，永远贴在视频区上 */
function ensureHostWindow(): void {
  if (alive(hostWin)) return
  const owner = alive(playWin)
  if (!owner) return
  const win = new BrowserWindow({
    parent: owner,
    frame: false,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  hostWin = win
  hostWid = handleToString(win.getNativeWindowHandle())
  win.on('closed', () => {
    hostWin = null
    hostReady = false
  })
  loadPage(win, 'host.html')
  win.once('ready-to-show', () => {
    hostReady = true
    applyHostVisibility()
  })
}

/** 宿主窗口只在「mpv 起来了」时显示：它是原生子窗口，显示着就一定压在网页之上 */
function applyHostVisibility(): void {
  const host = alive(hostWin)
  if (!host) return
  if (mpvActive && hostReady) host.showInactive()
  else host.hide()
}

function destroyHostWindow(): void {
  const win = hostWin
  hostWin = null
  hostWid = ''
  hostReady = false
  if (win && !win.isDestroyed()) win.destroy()
}

/** 会话层问「画面该嵌到哪 / 该摆到哪」时调这里 */
function canvasOf(): MpvCanvas {
  const win = alive(playWin)
  if (!win) return {}
  if (!isMac || loadSetting().app.macEmbed) {
    ensureHostWindow()
    return hostWid.length > 0 ? { wid: hostWid } : {}
  }
  const bounds = stageBounds(win)
  return { geometry: `${bounds.width}x${bounds.height}+${bounds.x}+${bounds.y}` }
}

/** 宿主窗口立刻跟随；macOS 挖洞方案交给防抖后的会话层命令 */
function notifyGeometry(): void {
  const win = alive(playWin)
  if (!win) return
  const host = alive(hostWin)
  if (host) host.setBounds(stageBounds(win))
  syncCanvasSoon()
  // 挖洞方案要求我们的窗口压在 mpv 独立窗口之上
  if (isMac) win.moveTop()
}

function notifyLayout(fullscreen: boolean): void {
  const win = alive(playWin)
  if (!win) return
  const payload: PlayerLayoutState = { fullscreen }
  win.webContents.send(PlayerChannels.layout, payload)
}

/** 视频区矩形（屏幕坐标）：宿主窗口的 bounds，macOS 独立窗口的 geometry 也用这个换算 */
function stageBounds(win: BrowserWindow): Electron.Rectangle {
  const bounds = win.getContentBounds()
  const rect = playerStageRect(bounds.width, bounds.height, isFullscreen(win))
  return {
    x: Math.round(bounds.x + rect.x),
    y: Math.round(bounds.y + rect.y),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height))
  }
}

function isFullscreen(win: BrowserWindow): boolean {
  return win.isFullScreen() || (isMac && win.isSimpleFullScreen())
}

/** 弹窗句柄转十进制字符串：Windows 是 HWND，macOS 是 NSView 指针，mpv 的 `--wid` 都收十进制 */
function handleToString(handle: Buffer): string {
  if (handle.length >= 8) return handle.readBigUInt64LE(0).toString()
  return String(handle.readUInt32LE(0))
}

function loadPage(win: BrowserWindow, page: string): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${page}`)
    return
  }
  void win.loadFile(join(__dirname, `../renderer/${page}`))
}

function alive(win: BrowserWindow | null): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null
}
