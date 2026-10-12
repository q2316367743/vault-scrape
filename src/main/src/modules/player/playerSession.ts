/**
 * 播放会话：应用级单例，管「当前播什么、用哪个后端、状态怎么推给渲染层」。
 *
 * 契约：
 * - 主进程是唯一权威：地址解析、后端选择（mpv / 内置 artplayer）、mpv 生命周期都在这里；
 * - 地址一律是回环播放服务给出的 `http://127.0.0.1:<port>/p/<token>/<连接 ID>/<媒体 ID>/<文件名>`，
 *   两个后端吃同一个地址，切后端只需重新 load；
 * - 找不到 / 没配置 mpv → 静默用内置播放器（`reason` 为空串）；配置了但起不来 → 回退内置播放器并回传 `reason`；
 * - 播放中途 mpv 自己退了 → 状态里 `backend` 降级为 `html5` 且 `error` 有值，渲染层据此切到内置播放器；
 * - 状态 200ms 节流推给窗口层，窗口层再发 `player:state`；
 * - 「在播哪个条目 / 哪一集、片名是什么」另由 `currentTarget()` 暴露给窗口层，
 *   供主窗口标题栏的「正在播放」标签使用（渲染层不必再查库）。
 */
import { buildMediaUrl, MEDIA_URL_PREFIX } from '@common/types/media';
import {
  buildPlayerState,
  type PlayerBackend,
  type PlayerCommand,
  type PlayerLoadResult,
  type PlayerOpenPayload,
  type PlayerState
} from '@common/types/player'
import { appendLog } from '$/db/repo/logRepo'
import { getItem, listSourcesByItem } from '$/db/repo/mediaRepo'
import type { MediaItemRow, MediaSourceRow } from '$/db/schema'
import { primarySourceOf } from '$/modules/media/mediaWall'
import { startMediaPlayServer } from '$/modules/media/mediaPlayServer'
import { locateMpv } from '$/modules/player/mpvLocator'
import { MpvRuntime } from '$/modules/player/mpvRuntime'
import { stripExtension } from '@common/types/scrape'

/** 状态推送节流间隔 */
const STATE_PUSH_MS = 200

/** Windows 宿主窗口句柄 / macOS 独立窗口几何：由窗口层提供，会话层只管用 */
export interface MpvCanvas {
  /** Windows：宿主窗口句柄（十进制字符串），有值即嵌入 */
  wid?: string
  /** macOS：独立窗口几何 `WxH+X+Y`（屏幕坐标） */
  geometry?: string
}

/** 当前装载的播放目标：主窗口标题栏据此显示「正在播放什么」 */
export interface PlayerTargetInfo {
  /** 条目 ID（`media_item.id`） */
  itemId: string
  /** 剧集正在播的那一集（`MediaEpisodeRef.itemId`）；影片为空串 */
  episodeId: string
  /** 片名：剧集是剧集名，影片是片名 */
  title: string
  /** 剧集这一集的说明（形如 `第 1 季 第 2 集`）；影片为空串 */
  subtitle: string
}

let runtime: MpvRuntime | null = null
let canvasProvider: (() => MpvCanvas) | null = null
let canvasSink: ((active: boolean) => void) | null = null
let sink: ((state: PlayerState) => void) | null = null
let currentBackend: PlayerBackend = 'html5'
let state: PlayerState = buildPlayerState()
let pushTimer: ReturnType<typeof setTimeout> | null = null
/** 是否有一场会话在跑（mpv 意外退出时用来判断要不要降级） */
let active = false
/** 当前装载的播放目标；收摊时清空 */
let target: PlayerTargetInfo | null = null

/** 窗口层注册：告诉会话层「画面该嵌到哪 / 该摆到哪」 */
export function setMpvCanvasProvider(provider: (() => MpvCanvas) | null): void {
  canvasProvider = provider
}

/**
 * 窗口层注册：mpv 是不是正在占着画面。
 *
 * Windows 的宿主窗口是**原生子窗口、永远压在网页之上**，所以它不能常驻显示：
 * 只有 mpv 真的起来了才显示（`true`），降级 / 收摊时必须藏起来，否则会盖住内置播放器。
 */
export function setMpvActiveSink(next: ((active: boolean) => void) | null): void {
  canvasSink = next
}

/** 窗口层注册：状态往哪推 */
export function setStateSink(next: ((state: PlayerState) => void) | null): void {
  sink = next
}

export function currentState(): PlayerState {
  return { ...state }
}

/** 当前装载的播放目标；没有会话返回 null */
export function currentTarget(): PlayerTargetInfo | null {
  return target ? { ...target } : null
}

/**
 * 装载播放目标：解析媒体源 → 起回环服务 → 找 mpv → 起 mpv（失败回退内置播放器）。
 *
 * 返回后渲染层拿到的是「用哪个后端 + 播什么地址」，随后的状态走 `player:state`。
 */
export async function loadTarget(payload: PlayerOpenPayload): Promise<PlayerLoadResult> {
  await stopSession()
  active = true

  const episodeId = payload.episodeId ?? ''
  const item = getItem(payload.itemId)
  const episode = episodeId.length > 0 && episodeId !== payload.itemId ? getItem(episodeId) : null
  /** 挂着媒体源的那一行：条目自己（影片 / 剧集条目）或指定的那一集；指定了集但读不到就没有源 */
  const owner = episodeId.length > 0 && episodeId !== payload.itemId ? episode : item
  const source = owner ? resolveSource(owner) : null
  target = item ? targetOf(item, episode) : null
  if (!item || !source) {
    appendLog({
      level: 'warn',
      scope: 'player',
      message: `播放目标没有可用媒体源：item=${payload.itemId}`
    })
    return { backend: 'html5', url: '', reason: '', itemId: payload.itemId, episodeId }
  }

  const server = await startMediaPlayServer()
  // 复用共享的地址构造函数，只把 `storage://` 换成回环前缀：路径形状永远与协议处理器一致
  const mediaUrl = buildMediaUrl(source.connectionId, source.id, source.name)
  const url = `${server.baseUrl}${mediaUrl.slice(MEDIA_URL_PREFIX.length)}`

  const mpv = await locateMpv()
  if (!mpv.found) {
    // 没配置 mpv 是正常状态：静默用内置播放器，说明文案只在设置页
    currentBackend = 'html5'
    state = buildPlayerState('html5')
    pushState(true)
    return { backend: 'html5', url, reason: '', itemId: payload.itemId, episodeId }
  }

  const canvas = canvasProvider?.() ?? {}
  try {
    const instance = await MpvRuntime.start({
      exe: mpv.path,
      url,
      title: item.name,
      volume: state.volume,
      ...(canvas.wid ? { wid: canvas.wid } : {}),
      ...(canvas.geometry ? { geometry: canvas.geometry } : {})
    })
    runtime = instance
    currentBackend = 'mpv'
    canvasSink?.(true)
    state = instance.getState()
    instance.onUpdate(() => {
      state = instance.getState()
      pushState()
    })
    instance.onExit((reason) => {
      degradeToHtml5(instance, reason)
    })
    pushState(true)
    return { backend: 'mpv', url, reason: '', itemId: payload.itemId, episodeId }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'mpv 启动失败'
    appendLog({
      level: 'warn',
      scope: 'player',
      message: `mpv 启动失败，改用内置播放器：${reason}`
    })
    currentBackend = 'html5'
    state = buildPlayerState('html5')
    pushState(true)
    // 回给界面的是人话，技术细节（stderr / 退出码）留在上面那条日志里
    return { backend: 'html5', url, reason: 'mpv 播放失败，已改用内置播放器', itemId: payload.itemId, episodeId }
  }
}

/** 渲染层命令（内置播放器后端的命令由渲染层自己处理，这里只兜 mpv） */
export async function runCommand(command: PlayerCommand): Promise<void> {
  const instance = runtime
  if (!instance) return
  try {
    await instance.runCommand(command)
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    appendLog({ level: 'warn', scope: 'player', message: `mpv 命令失败：${message}` })
  }
}

/**
 * 窗口几何变了：Windows 嵌入模式不用管（mpv 自己跟宿主客户区对齐），
 * macOS 独立窗口先试运行时改，改不了就按新几何重启进程（调用方已防抖）。
 */
export async function syncCanvas(): Promise<void> {
  const instance = runtime
  const canvas = canvasProvider?.() ?? null
  if (!instance || !canvas || canvas.wid || !canvas.geometry) return
  if (await instance.tryGeometry(canvas.geometry)) return
  try {
    await instance.restartWithGeometry(canvas.geometry)
    state = instance.getState()
    pushState(true)
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    appendLog({ level: 'warn', scope: 'player', message: `mpv 窗口几何同步失败：${message}` })
  }
}

/** 关播放窗口 / 换片前收摊：mpv 停掉，状态回到初始 */
export async function stopSession(): Promise<void> {
  active = false
  target = null
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
  const instance = runtime
  runtime = null
  if (instance) await instance.stop()
  canvasSink?.(false)
  currentBackend = 'html5'
  state = buildPlayerState('html5')
}

/** 当前后端（窗口层决定要不要给宿主窗口让位） */
export function activeBackend(): PlayerBackend {
  return currentBackend
}

/** mpv 意外退出：状态降级到内置播放器，让渲染层接着播（带原因） */
function degradeToHtml5(instance: MpvRuntime, reason: string): void {
  if (runtime !== instance || !active) return
  runtime = null
  currentBackend = 'html5'
  canvasSink?.(false)
  state = {
    ...instance.getState(),
    backend: 'html5',
    ready: false,
    ended: false,
    buffering: false,
    // 界面只看人话；`reason`（stderr / 退出码）进下面那条日志
    error: 'mpv 已退出，已切回内置播放器'
  }
  appendLog({
    level: 'warn',
    scope: 'player',
    message: `mpv 异常退出，已切回内置播放器：${reason}`
  })
  pushState(true)
}

/** 条目 + 可选剧集条目 → 该播哪条媒体源（只有 `episode` 挂源，剧集 / 季条目没有） */
function resolveSource(owner: MediaItemRow): MediaSourceRow | null {
  return primarySourceOf(owner, listSourcesByItem(owner.id)) ?? null
}

/** 组装「在播什么」：剧集给剧集名 + 这一集的说明，影片只给片名 */
function targetOf(item: MediaItemRow, episode: MediaItemRow | null): PlayerTargetInfo {
  return {
    itemId: item.id,
    episodeId: episode?.id ?? '',
    title: displayTitle(item),
    subtitle: episode ? episodeLabel(episode) : ''
  }
}

/** 片名口径与影视墙一致：刮削过就是条目名，没刮削过去掉扩展名 */
function displayTitle(row: MediaItemRow): string {
  return row.scrapedAt > 0 ? row.name : stripExtension(row.name)
}

/** 集说明：特别篇（季号 0）只写集号 */
function episodeLabel(episode: MediaItemRow): string {
  const season = episode.seasonNumber > 0 ? `第 ${episode.seasonNumber} 季 ` : ''
  return `${season}第 ${episode.episodeNumber} 集`
}

function pushState(force = false): void {
  if (!sink) return
  if (force) {
    flush()
    return
  }
  if (pushTimer) return
  pushTimer = setTimeout(() => {
    pushTimer = null
    flush()
  }, STATE_PUSH_MS)
}

function flush(): void {
  sink?.({ ...state })
}
