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
 * - 全屏时侧栏与控制条收起（`player:layout` 告诉渲染层），视频区随之扩到整块内容区；
 * - Windows 才用 `frame: false`（三键由 `AppTitleBar` 自绘）；macOS 用 `titleBarStyle: 'hidden'`，
 *   系统红黄绿灯照常显示，自绘标题栏让开左侧 80px；
 * - 控制条与视频区背景随「后端 + 平台」变（`controlBarRow` / `transparentStage`）：原生 mpv 子窗口会压住
 *   网页控件，嵌入模式下控制条只能独占一行；macOS 独立窗口模式反过来要悬浮，并给 mpv 挖透明洞。
 *   这两个字段与 `playerStageRect` 的实参必须同源，否则画面与网页会错位。
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
/** 上次推给渲染层的布局：状态推送是 200ms 一次的，没变就不重复发 */
let pushedLayout: PlayerLayoutState | null = null
/** 上次推状态时的后端：用来在 mpv / 内置之间切换时补推一次布局 */
let lastBackend = ''

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
  const win = new BrowserWindow(playWindowOptions(holeNeeded()))
  playWin = win
  setStateSink((state) => {
    const target = alive(playWin)
    if (target) target.webContents.send(PlayerChannels.state, state)
    // 主窗口标题栏的「正在播放」跟着一起走（播放中就是这 200ms 一次的节流推送）
    broadcastPlayerStatus(statusOf(state))
    // 后端换了：控制条怎么摆、视频区要不要透明都跟着变
    if (state.backend !== lastBackend) {
      lastBackend = state.backend
      notifyLayout()
    }
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
  // 页面（重新）加载完先把当前布局同步过去：渲染层不该靠默认值猜控制条怎么摆
  win.webContents.on('did-finish-load', () => {
    pushedLayout = null
    notifyLayout()
  })
  win.on('closed', () => {
    playWin = null
    pushedLayout = null
    lastBackend = ''
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

function playWindowOptions(hole: boolean): BrowserWindowConstructorOptions {
  const base: BrowserWindowConstructorOptions = {
    width: PLAY_LAYOUT.defaultWidth,
    height: PLAY_LAYOUT.defaultHeight,
    minWidth: PLAY_LAYOUT.minWidth,
    minHeight: PLAY_LAYOUT.minHeight,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  }
  // macOS 不能写 `frame: false`：无边框会连系统红黄绿灯一起去掉，而 `AppTitleBar` 在 mac 上不画窗口三键
  // （约定是「系统红黄绿灯 + 自绘标题栏」），结果就是窗口没有标题栏、也关不掉。
  // 与主窗口同款：`titleBarStyle: 'hidden'` 藏标题栏但保留红黄绿灯，自绘标题栏靠 `padding-left: 80px` 让位。
  if (isMac) {
    return {
      ...base,
      // 不再挖洞：macOS 已停用 mpv（见 `holeNeeded`），而透明窗口正是播放周期性卡顿的根因
      transparent: hole,
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 12, y: 14 }
    }
  }
  return { ...base, frame: false, backgroundColor: '#000000' }
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
  if (embeddedLayout()) {
    ensureHostWindow()
    return hostWid.length > 0 ? { wid: hostWid } : {}
  }
  const bounds = stageBounds(win)
  return { geometry: mpvGeometry(bounds) }
}

/**
 * 把视频区矩形（DIP）换算成 mpv 认的 `WxH+X+Y`。
 *
 * mpv 在 macOS 上把 `--geometry` 当**设备像素**读，而且 X/Y 以显示器工作区（菜单栏下方）左上角为
 * 原点——两条都与 Electron 的 DIP / 屏幕坐标不一致。直接把 DIP 数值塞进去，2x 屏上 mpv 只会开到
 * 「一半尺寸 + 一半坐标」：画面缩在左上角、还压在标题栏与侧栏上。`scaleFactor` 与 `workArea` 都取
 * 视频区所在的那块屏（多显示器时不能拿主屏算）。
 *
 * 注意：macOS 停用 mpv 之后这条路径暂时走不到（Windows 走 `--wid`），保留是为了将来 macOS 恢复
 * mpv 时不用重新推一遍这套换算（数据见 `docs/media/03-mpv-playback.md` §4 / §11 第 15 条）。
 */
function mpvGeometry(bounds: Electron.Rectangle): string {
  const display = screen.getDisplayMatching(bounds)
  const scale = display.scaleFactor > 0 ? display.scaleFactor : 1
  const width = Math.round(bounds.width * scale)
  const height = Math.round(bounds.height * scale)
  const x = Math.round((bounds.x - display.workArea.x) * scale)
  const y = Math.round((bounds.y - display.workArea.y) * scale)
  return `${width}x${height}${offset(x)}${offset(y)}`
}

/** mpv 的 `WxH+X+Y` 只认带符号的偏移：屏幕在主显示器左边 / 上边时坐标是负的，不能硬拼 `+` */
function offset(value: number): string {
  return value >= 0 ? `+${String(value)}` : String(value)
}

/** 画面走 mpv 原生窗口（Windows 恒是；`app.macEmbed` 是 macOS 的历史开关，mpv 停用后已无界面） */
function embeddedLayout(): boolean {
  return !isMac || loadSetting().app.macEmbed
}

/**
 * 播放窗口要不要挖洞（透明）。
 *
 * 恒为 `false`：挖洞只服务「macOS 的 mpv 独立窗口」（mpv 画面在它自己的窗口里，我们的窗口得透出这一块），
 * 而 macOS 已经停用 mpv（见 `mpvLocator`：`--wid` 无 macOS 支持，只剩这条路，而透明窗口实测会让播放
 * 周期性卡顿、窗口跟随还有可见延迟）。Windows 走嵌入方案，同样不需要透明。保留这个函数是为了让「要不要
 * 透明」只有一个出口——将来 macOS 恢复 mpv 时改这里即可。
 */
function holeNeeded(): boolean {
  return false
}

/** 推给渲染层的布局：全屏 / 控制条怎么摆 / 视频区背景，都由这一条通道说清楚 */
function layoutOf(fullscreen: boolean): PlayerLayoutState {
  const embedded = embeddedLayout()
  const mpv = currentState().backend === 'mpv'
  return {
    fullscreen,
    // 控制条只能在没有原生子窗口压在网页上时悬浮，否则会被子窗口盖住，只能独占一行
    controlBarRow: mpv && embedded,
    // 恒 false：透明挖洞只给 macOS 的 mpv 独立窗口用，而 macOS 已停用 mpv（见 `holeNeeded`）
    transparentStage: false
  }
}

/** 宿主窗口立刻跟随；其他窗口形态没有要同步的原生画面 */
function notifyGeometry(): void {
  const win = alive(playWin)
  if (!win) return
  const host = alive(hostWin)
  if (host) host.setBounds(stageBounds(win))
  syncCanvasSoon()
}

/**
 * 推布局给渲染层：全屏 / 控制条占位 / 视频区透明。
 *
 * 不传 `fullscreen` 就按窗口当前的全屏状态算（后端切换、页面加载完都要补推一次）。
 */
function notifyLayout(fullscreen?: boolean): void {
  const win = alive(playWin)
  if (!win) return
  const payload = layoutOf(fullscreen ?? isFullscreen(win))
  const last = pushedLayout
  if (
    last &&
    last.fullscreen === payload.fullscreen &&
    last.controlBarRow === payload.controlBarRow &&
    last.transparentStage === payload.transparentStage
  ) {
    return
  }
  pushedLayout = payload
  win.webContents.send(PlayerChannels.layout, payload)
}

/**
 * 视频区矩形（屏幕坐标）：宿主窗口的 bounds（macOS 停用 mpv 后只剩这条路）。
 *
 * 这里**一律按 mpv 画面算**（嵌入模式扣掉控制条那一行）：这个矩形只在 mpv 占着画面时才有意义，
 * 而那时渲染层的控制条排法正好与它同源；内置播放器根本不看这个矩形。
 */
function stageBounds(win: BrowserWindow): Electron.Rectangle {
  const bounds = win.getContentBounds()
  const rect = playerStageRect(bounds.width, bounds.height, isFullscreen(win), embeddedLayout())
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

/**
 * 弹窗句柄转十进制字符串：Windows 是 HWND，mpv 的 `--wid` 收十进制。
 *
 * 这里原本写着「macOS 是 NSView 指针」，但 mpv 的 `--wid` **没有 macOS 支持**（只文档化了 X11 /
 * win32 / Android，见 `docs/media/03-mpv-playback.md` §11 第 19 条），macOS 已停用 mpv，这条只在
 * Windows 上会走到。
 */
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
