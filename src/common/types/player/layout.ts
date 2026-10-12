/**
 * 播放窗口的布局常量。
 *
 * 契约：主进程按这份常量算「视频区矩形」（Windows 宿主窗口的 bounds；macOS 停用 mpv 后只剩 HTML 布局），
 * 渲染层用同一份常量排 HTML 布局；两边必须一致，所以只此一处定义。
 * 布局形状：顶部自绘标题栏、左侧视频区、右侧详情侧栏；控制条**要么独占视频区下方一行、要么悬浮在画面上**
 * （见 `playerStageRect` 的 `controlBarRow`：mpv 画面是原生子窗口时会被压在控件之下，只能占一行）。
 */
export const PLAY_LAYOUT = {
  /** 自绘标题栏高度（与主窗口标题栏一致） */
  headerHeight: 40,
  /** 右侧详情侧栏宽度 */
  sidebarWidth: 360,
  /** 控制条高度（占一行时扣减视频区，悬浮时叠在画面上） */
  controlBarHeight: 72,
  /** 播放窗口默认尺寸 */
  defaultWidth: 1280,
  defaultHeight: 800,
  /** 播放窗口最小尺寸 */
  minWidth: 1040,
  minHeight: 640
} as const

/** 视频区相对内容区左上角的矩形（内容区 = 窗口去掉标题栏之后的区域） */
export interface PlayerStageRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 按内容区尺寸算视频区矩形。
 *
 * 契约：内容区尺寸与窗口尺寸不同（macOS 无边框窗口的内容区就是窗口本身，Windows 也是），
 * 因此调用方传的是 `win.getContentBounds()`；结果可能为负宽高（窗口被拖得极小），调用方要自行钳制；
 * 全屏时侧栏与控制条由渲染层收起，画面占满整块内容区；
 * `controlBarRow` 为真表示控制条独占视频区下方一行（视频区要扣掉它的高度），为假表示控制条悬浮在画面上
 * （视频区一直铺到侧栏底部），两侧必须传同一个值。
 */
export function playerStageRect(
  contentWidth: number,
  contentHeight: number,
  fullscreen = false,
  controlBarRow = true
): PlayerStageRect {
  if (fullscreen) return { x: 0, y: 0, width: contentWidth, height: contentHeight }
  const reserved = controlBarRow ? PLAY_LAYOUT.controlBarHeight : 0
  return {
    x: 0,
    y: PLAY_LAYOUT.headerHeight,
    width: contentWidth - PLAY_LAYOUT.sidebarWidth,
    height: contentHeight - PLAY_LAYOUT.headerHeight - reserved
  }
}

/** 播放窗口布局状态：主进程推给渲染层，渲染层据此决定侧栏 / 控制条 / 视频区背景 */
export interface PlayerLayoutState {
  /** 是否整窗全屏（全屏时只有画面） */
  fullscreen: boolean
  /** 控制条是否独占视频区下方一行（假 = 悬浮在画面上，且视频区不扣它的高度） */
  controlBarRow: boolean
  /**
   * 视频区是否透明。
   *
   * 契约：当前**恒为 false**——透明只服务「macOS 独立 mpv 窗口 + 挖洞」，而 macOS 已停用 mpv
   * （见 `docs/media/03-mpv-playback.md`，透明窗口是播放卡顿的根因）；字段保留是为了将来恢复该方案时
   * 不用改协议。
   */
  transparentStage: boolean
}
