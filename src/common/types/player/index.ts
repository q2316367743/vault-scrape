/**
 * 播放窗口（mpv / 内置 artplayer）的公共契约。
 *
 * 契约：
 * - 主进程是播放状态的唯一权威：地址解析、后端选择与 mpv 生命周期都在主进程，渲染层只发命令、收状态；
 * - 播放地址一律是主进程回环播放服务给出的 `http://127.0.0.1:<port>/p/<token>/...`
 *   （协议名在 `@common/types/media` 的 `MEDIA_URL_PREFIX`，服务端复用 `storage://` 的 Range 读取与自愈逻辑），
 *   mpv 与 artplayer 吃同一个地址，切后端只需重新 load；
 * - `reason` 只在「用户配置了 mpv 但它起不来」时有值：没配置 mpv 时静默走内置播放器，播放窗口不提示，
 *   说明文案只出现在设置页。
 */

/** 播放后端：mpv（本机自备，设置项给路径）或 html5（内置 artplayer） */
export type PlayerBackend = 'mpv' | 'html5'

/** mpv 可执行文件的来源 */
export type PlayerMpvOrigin = 'setting' | 'path' | 'well-known' | 'none'

/** 打开播放窗口 / 切换播放目标的入参 */
export interface PlayerOpenPayload {
  /** 条目 ID（`media_item.id`） */
  itemId: string
  /** 剧集要播哪一集（剧集条目的 itemId，即 `MediaEpisodeRef.itemId`）；影片不传 */
  episodeId?: string
}

/** 一次装载的结果：主进程解析出地址、选好后端之后的产物 */
export interface PlayerLoadResult {
  backend: PlayerBackend
  /** 交给 mpv / artplayer 的播放地址（回环 http）；条目没有媒体源时为空串 */
  url: string
  /**
   * 后端降级原因（仅「配置了 mpv 但它起不来」时非空）。
   *
   * 契约：**面向用户的提示文案**，渲染层直接把它显示在播放画面上的提示条里，所以要写人话
   * （如「mpv 播放失败，已改用内置播放器」）；mpv 的 stderr / 退出码这类技术细节只进主进程日志。
   */
  reason: string
  /** 这次装的是哪个条目，右侧侧栏据此取详情（`media_item.id`） */
  itemId: string
  /** 这次装的是哪一集（`MediaEpisodeRef.itemId`）；影片为空串 */
  episodeId: string
}

/** mpv 探测结果：设置页的「检测」按钮用 */
export interface PlayerProbeResult {
  found: boolean
  /** 实际使用的可执行文件路径；没找到为空串 */
  path: string
  /** `mpv --version` 的第一行（形如 `mpv v0.37.0`）；取不到为空串 */
  version: string
  origin: PlayerMpvOrigin
}

/**
 * 播放状态快照：主进程按 200ms 节流后推给渲染层。
 *
 * 契约：内置播放器后端由渲染层的 artplayer 事件折算成同一份形状（`PlayerState` 只有一个形状，
 * 组件不必按后端分叉）。
 */
export interface PlayerState {
  backend: PlayerBackend
  /** 是否已就绪（mpv 的 `file-loaded` / artplayer 的 `canplay`） */
  ready: boolean
  paused: boolean
  /** 当前播放位置（秒） */
  position: number
  /** 总时长（秒）；未知为 0 */
  duration: number
  /** 音量 0-1 */
  volume: number
  muted: boolean
  /** 倍速 */
  rate: number
  /** 是否正在缓冲 */
  buffering: boolean
  /** 是否已播完 */
  ended: boolean
  /**
   * 后端异常信息，空串表示正常。
   *
   * 契约：只在「播放中途 mpv 自己退了」时有值，此时 `backend` 会一并降级为 `html5`，
   * 渲染层据此切到内置播放器并原样显示这句话。
   */
  error: string
}

/**
 * 主窗口标题栏「正在播放」标签的快照。
 *
 * 契约：与 `PlayerState` 分开——「播放窗口在不在、在播什么」只有主进程知道，
 * 渲染层不自行拼装；播放窗口关掉后 `open` 立刻变 false，标签随之消失。
 * 因为没有主窗口句柄，这份快照按 file / offline / scrape 域的惯例广播给所有窗口，
 * 只有主窗口的标题栏订阅它。
 */
export interface PlayerStatus {
  /** 播放窗口是否存在；false 时其余字段全是空值 */
  open: boolean
  /** 正在播的条目（`media_item.id`） */
  itemId: string
  /** 剧集正在播的那一集（`MediaEpisodeRef.itemId`）；影片为空串 */
  episodeId: string
  /** 片名（剧集是剧集名，不是集名）；目标还没装载时为空串 */
  title: string
  /** 剧集这一集的说明（形如 `第 1 季 第 2 集`）；影片为空串 */
  subtitle: string
  /** 播放器状态；没有会话时是初始状态 */
  state: PlayerState
}

/** 渲染层发给播放后端的命令；换片 / 换集走 `player:load`，不在这里 */
export type PlayerCommand =
  | { kind: 'toggle' }
  | { kind: 'seek'; position: number }
  | { kind: 'seekBy'; delta: number }
  | { kind: 'volume'; volume: number }
  | { kind: 'mute'; muted: boolean }
  | { kind: 'rate'; rate: number }
  /**
   * 全屏开关：这是窗口层的事（嵌入模式下 mpv 管不了父窗口，命令不下发给 mpv）。
   * 不传 `enabled` 表示切换当前状态 —— 双击视频、Esc 这类「不知道当前是不是全屏」的入口用它。
   */
  | { kind: 'fullscreen'; enabled?: boolean }

/** 初始状态：渲染层与主进程开工前都用它 */
export function buildPlayerState(backend: PlayerBackend = 'html5'): PlayerState {
  return {
    backend,
    ready: false,
    paused: true,
    position: 0,
    duration: 0,
    volume: 0.8,
    muted: false,
    rate: 1,
    buffering: false,
    ended: false,
    error: ''
  }
}
